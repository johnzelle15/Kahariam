"""
Settings API — User profile, password, security, notifications, and system management.

Routes:
  GET  /api/v1/settings/me                    — Current user profile
  PUT  /api/v1/settings/profile               — Update fullname / username / email
  POST /api/v1/settings/profile-image         — Upload profile image (base64)
  PUT  /api/v1/settings/password              — Change password (requires current password)
  GET  /api/v1/settings/login-history         — Paginated login history
  GET  /api/v1/settings/security-activity     — Recent security events
  GET  /api/v1/settings/notification-prefs    — Get notification preferences
  PUT  /api/v1/settings/notification-prefs    — Update notification preferences
  GET  /api/v1/settings/system-status         — [Admin] DB/server health
  GET  /api/v1/settings/staff                 — [Admin] List staff accounts
  POST /api/v1/settings/staff                 — [Admin] Create staff account
  PUT  /api/v1/settings/staff/<int:uid>       — [Admin] Update staff account
  POST /api/v1/settings/staff/<int:uid>/toggle — [Admin] Activate/deactivate staff
  GET  /api/v1/settings/audit-logs            — [Admin] Audit log (paginated)
"""

import base64
import os
import platform
import re
import time
from datetime import datetime
from functools import wraps

import bcrypt
from flask import Blueprint, jsonify, request

from backend.api.auth_otp import require_auth
from backend.core.db import get_db

settings_bp = Blueprint('settings', __name__, url_prefix='/api/v1/settings')

# ── Helpers ───────────────────────────────────────────────────────────────────

_SAFE_USERNAME_RE = re.compile(r'^[a-zA-Z0-9_\-\.]{3,50}$')
_SAFE_EMAIL_RE    = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

PASSWORD_MIN_LEN = 8
PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024  # 2 MB


def require_admin(f):
    """Decorator: requires role == 'admin'. Must be used AFTER @require_auth."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if getattr(request, 'user', {}).get('role') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated


def _get_client_ip():
    """Return best-effort client IP, honouring X-Forwarded-For."""
    xff = request.headers.get('X-Forwarded-For', '')
    if xff:
        return xff.split(',')[0].strip()
    return request.remote_addr or ''


def _get_device_info():
    """Extract a short device/browser string from User-Agent."""
    ua = request.headers.get('User-Agent', '')
    return ua[:255] if ua else 'Unknown'


def _log_audit(conn, user_id, action, object_type=None, object_id=None, details=None):
    """Insert a row into audit_logs (includes request IP)."""
    try:
        ip = _get_client_ip()
        c = conn.cursor()
        c.execute(
            '''INSERT INTO audit_logs (user_id, action, object_type, object_id, details, ip_address)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (user_id, action, object_type, object_id, details, ip),
        )
    except Exception:
        pass  # audit failure must not break the main response


def _password_strength(pw: str) -> str:
    """Return 'weak' / 'fair' / 'strong' based on simple heuristics."""
    if len(pw) < 8:
        return 'weak'
    score = 0
    if re.search(r'[A-Z]', pw): score += 1
    if re.search(r'[a-z]', pw): score += 1
    if re.search(r'\d',   pw): score += 1
    if re.search(r'[^A-Za-z0-9]', pw): score += 1
    if len(pw) >= 12: score += 1
    if score <= 2: return 'weak'
    if score == 3: return 'fair'
    return 'strong'


# ── Profile ───────────────────────────────────────────────────────────────────

@settings_bp.route('/me', methods=['GET'])
@require_auth
def get_me():
    """Return the authenticated user's full profile."""
    uid = request.user['sub']
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute(
            '''SELECT id, username, email, role, fullname, profile_image,
                      last_login, failed_attempts, created_at, active
               FROM users WHERE id = ?''',
            (uid,),
        )
        row = c.fetchone()
        if not row:
            return jsonify({'error': 'User not found'}), 404

        return jsonify({
            'id':              row['id'],
            'username':        row['username'],
            'email':           row['email'] or '',
            'role':            row['role'] or 'staff',
            'fullname':        row['fullname'] or '',
            'profile_image':   row['profile_image'] or '',
            'last_login':      str(row['last_login']) if row['last_login'] else None,
            'failed_attempts': row['failed_attempts'] or 0,
            'created_at':      str(row['created_at']) if row['created_at'] else None,
            'active':          bool(row['active']),
        }), 200
    finally:
        conn.close()


@settings_bp.route('/profile', methods=['PUT'])
@require_auth
def update_profile():
    """Update fullname, email (username is read-only for staff)."""
    uid  = request.user['sub']
    role = request.user.get('role', 'staff')
    data = request.get_json(silent=True) or {}

    fullname = (data.get('fullname') or '').strip()
    email    = (data.get('email') or '').strip()
    username = (data.get('username') or '').strip()

    # Validate
    if email and not _SAFE_EMAIL_RE.match(email):
        return jsonify({'error': 'Invalid email address'}), 400
    if username and not _SAFE_USERNAME_RE.match(username):
        return jsonify({'error': 'Username must be 3–50 characters: letters, digits, _ - .'}), 400
    if fullname and len(fullname) > 200:
        return jsonify({'error': 'Full name too long (max 200 chars)'}), 400

    conn = get_db()
    try:
        c = conn.cursor()

        # Check username uniqueness if changing
        if username:
            c.execute('SELECT id FROM users WHERE username = ? AND id != ?', (username, uid))
            if c.fetchone():
                return jsonify({'error': 'Username already taken'}), 409

        # Check email uniqueness
        if email:
            c.execute('SELECT id FROM users WHERE email = ? AND id != ?', (email, uid))
            if c.fetchone():
                return jsonify({'error': 'Email already in use'}), 409

        # Build SET clause dynamically to only update provided fields
        fields, values = [], []
        if fullname is not None:
            fields.append('fullname = ?'); values.append(fullname or None)
        if email:
            fields.append('email = ?'); values.append(email)
        if username and (role == 'admin'):
            # Only admins can rename themselves; staff usernames are fixed
            fields.append('username = ?'); values.append(username)
        if not fields:
            return jsonify({'error': 'No fields to update'}), 400

        fields.append('updated_at = NOW()')
        values.append(uid)
        c.execute(f'UPDATE users SET {", ".join(fields)} WHERE id = ?', values)
        conn.commit()

        _log_audit(conn, uid, 'UPDATE_PROFILE', 'users', str(uid))
        conn.commit()

        return jsonify({'message': 'Profile updated successfully'}), 200
    finally:
        conn.close()


@settings_bp.route('/profile-image', methods=['POST'])
@require_auth
def update_profile_image():
    """Accept a base64-encoded image and store it on the user row."""
    uid  = request.user['sub']
    data = request.get_json(silent=True) or {}
    img  = (data.get('image') or '').strip()

    if not img:
        return jsonify({'error': 'No image provided'}), 400

    # Strip data URI prefix if present
    if ',' in img:
        img = img.split(',', 1)[1]

    # Validate base64 + size
    try:
        raw = base64.b64decode(img, validate=True)
    except Exception:
        return jsonify({'error': 'Invalid base64 image data'}), 400

    if len(raw) > PROFILE_IMAGE_MAX_BYTES:
        return jsonify({'error': 'Image too large (max 2 MB)'}), 413

    # Re-encode cleanly
    clean_b64 = base64.b64encode(raw).decode('ascii')
    # Detect MIME type from header bytes
    mime = 'image/jpeg'
    if raw[:8] == b'\x89PNG\r\n\x1a\n':
        mime = 'image/png'
    elif raw[:4] == b'GIF8':
        mime = 'image/gif'
    data_uri = f'data:{mime};base64,{clean_b64}'

    conn = get_db()
    try:
        c = conn.cursor()
        c.execute('UPDATE users SET profile_image = ?, updated_at = NOW() WHERE id = ?',
                  (data_uri, uid))
        conn.commit()
        return jsonify({'message': 'Profile image updated', 'profile_image': data_uri}), 200
    finally:
        conn.close()


# ── Password ──────────────────────────────────────────────────────────────────

@settings_bp.route('/password', methods=['PUT'])
@require_auth
def change_password():
    """
    Change the authenticated user's password.
    Requires: { current_password, new_password, confirm_password }
    """
    uid  = request.user['sub']
    data = request.get_json(silent=True) or {}

    current  = data.get('current_password') or ''
    new_pw   = data.get('new_password') or ''
    confirm  = data.get('confirm_password') or ''

    if not current or not new_pw or not confirm:
        return jsonify({'error': 'All password fields are required'}), 400
    if new_pw != confirm:
        return jsonify({'error': 'New passwords do not match'}), 400
    if len(new_pw) < PASSWORD_MIN_LEN:
        return jsonify({'error': f'Password must be at least {PASSWORD_MIN_LEN} characters'}), 400
    if _password_strength(new_pw) == 'weak':
        return jsonify({'error': 'Password is too weak. Use uppercase, lowercase, numbers and symbols.'}), 400
    if new_pw == current:
        return jsonify({'error': 'New password must differ from current password'}), 400

    conn = get_db()
    try:
        c = conn.cursor()
        c.execute('SELECT password_hash FROM users WHERE id = ?', (uid,))
        row = c.fetchone()
        if not row:
            return jsonify({'error': 'User not found'}), 404

        if not bcrypt.checkpw(current.encode('utf-8'), row['password_hash'].encode('utf-8')):
            return jsonify({'error': 'Current password is incorrect'}), 401

        new_hash = bcrypt.hashpw(new_pw.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')
        c.execute('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
                  (new_hash, uid))
        conn.commit()

        _log_audit(conn, uid, 'CHANGE_PASSWORD', 'users', str(uid))
        conn.commit()

        return jsonify({'message': 'Password changed successfully'}), 200
    finally:
        conn.close()


# ── Login History ─────────────────────────────────────────────────────────────

@settings_bp.route('/login-history', methods=['GET'])
@require_auth
def get_login_history():
    """Return paginated login history for the current user."""
    uid   = request.user['sub']
    page  = max(1, int(request.args.get('page', 1)))
    limit = min(50, max(1, int(request.args.get('limit', 10))))
    offset = (page - 1) * limit

    conn = get_db()
    try:
        c = conn.cursor()
        c.execute(
            '''SELECT id, ip_address, device, login_time, status
               FROM login_history
               WHERE user_id = ?
               ORDER BY login_time DESC
               LIMIT ? OFFSET ?''',
            (uid, limit, offset),
        )
        rows = c.fetchall()

        c.execute('SELECT COUNT(*) AS cnt FROM login_history WHERE user_id = ?', (uid,))
        total = c.fetchone()['cnt']

        history = [
            {
                'id':         r['id'],
                'ip_address': r['ip_address'],
                'device':     r['device'],
                'login_time': str(r['login_time']),
                'status':     r['status'],
            }
            for r in rows
        ]
        return jsonify({'history': history, 'total': total, 'page': page, 'limit': limit}), 200
    finally:
        conn.close()


@settings_bp.route('/security-activity', methods=['GET'])
@require_auth
def get_security_activity():
    """Return recent audit log entries for the current user (last 20)."""
    uid = request.user['sub']
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute(
            '''SELECT id, action, object_type, details, created_at
               FROM audit_logs WHERE user_id = ?
               ORDER BY created_at DESC LIMIT 20''',
            (uid,),
        )
        rows = c.fetchall()
        events = [
            {
                'id':          r['id'],
                'action':      r['action'],
                'object_type': r['object_type'],
                'details':     r['details'],
                'created_at':  str(r['created_at']),
            }
            for r in rows
        ]
        return jsonify({'events': events}), 200
    finally:
        conn.close()


# ── Notification Preferences ──────────────────────────────────────────────────

@settings_bp.route('/notification-prefs', methods=['GET'])
@require_auth
def get_notification_prefs():
    uid = request.user['sub']
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute('SELECT * FROM notification_prefs WHERE user_id = ?', (uid,))
        row = c.fetchone()
        if not row:
            # Return defaults
            return jsonify({
                'email_notifications': True,
                'inventory_alerts':    True,
                'revenue_alerts':      True,
                'anomaly_alerts':      True,
                'task_reminders':      True,
                'system_warnings':     True,
            }), 200
        return jsonify({
            'email_notifications': bool(row['email_notifications']),
            'inventory_alerts':    bool(row['inventory_alerts']),
            'revenue_alerts':      bool(row['revenue_alerts']),
            'anomaly_alerts':      bool(row['anomaly_alerts']),
            'task_reminders':      bool(row['task_reminders']),
            'system_warnings':     bool(row['system_warnings']),
        }), 200
    finally:
        conn.close()


@settings_bp.route('/notification-prefs', methods=['PUT'])
@require_auth
def update_notification_prefs():
    uid  = request.user['sub']
    data = request.get_json(silent=True) or {}

    fields = [
        'email_notifications', 'inventory_alerts', 'revenue_alerts',
        'anomaly_alerts', 'task_reminders', 'system_warnings',
    ]
    vals = {f: bool(data.get(f, True)) for f in fields}

    conn = get_db()
    try:
        c = conn.cursor()
        c.execute('SELECT id FROM notification_prefs WHERE user_id = ?', (uid,))
        if c.fetchone():
            c.execute(
                '''UPDATE notification_prefs
                   SET email_notifications=?, inventory_alerts=?, revenue_alerts=?,
                       anomaly_alerts=?, task_reminders=?, system_warnings=?,
                       updated_at=NOW()
                   WHERE user_id=?''',
                (*[vals[f] for f in fields], uid),
            )
        else:
            c.execute(
                '''INSERT INTO notification_prefs
                   (user_id, email_notifications, inventory_alerts, revenue_alerts,
                    anomaly_alerts, task_reminders, system_warnings)
                   VALUES (?, ?, ?, ?, ?, ?, ?)''',
                (uid, *[vals[f] for f in fields]),
            )
        conn.commit()
        return jsonify({'message': 'Preferences saved'}), 200
    finally:
        conn.close()


# ── System Status (Admin) ─────────────────────────────────────────────────────

@settings_bp.route('/system-status', methods=['GET'])
@require_auth
@require_admin
def system_status():
    """Return system health info for the admin System tab."""
    conn = get_db()
    try:
        c = conn.cursor()

        # DB version
        c.execute('SELECT VERSION() AS ver')
        db_version = c.fetchone()['ver']

        # Table sizes (approximate)
        c.execute(
            '''SELECT TABLE_NAME AS tname,
                      ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024, 1) AS size_kb,
                      TABLE_ROWS AS row_count
               FROM information_schema.TABLES
               WHERE TABLE_SCHEMA = DATABASE()
               ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC
               LIMIT 12'''
        )
        tables = [
            {'name': r['tname'], 'size_kb': float(r['size_kb'] or 0), 'rows': int(r['row_count'] or 0)}
            for r in c.fetchall()
        ]

        # User counts
        c.execute("SELECT COUNT(*) AS cnt FROM users WHERE active = 1")
        active_users = c.fetchone()['cnt']
        c.execute("SELECT COUNT(*) AS cnt FROM users WHERE active = 0")
        inactive_users = c.fetchone()['cnt']

        # Audit log count
        c.execute('SELECT COUNT(*) AS cnt FROM audit_logs')
        audit_count = c.fetchone()['cnt']

        # DB total size
        c.execute(
            '''SELECT ROUND(SUM(DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) AS total_mb
               FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'''
        )
        total_mb = float((c.fetchone() or {}).get('total_mb') or 0)

        return jsonify({
            'db_version':    db_version,
            'db_size_mb':    total_mb,
            'tables':        tables,
            'active_users':  int(active_users),
            'inactive_users': int(inactive_users),
            'audit_count':   int(audit_count),
            'python_version': platform.python_version(),
            'platform':      platform.system(),
            'server_time':   datetime.utcnow().isoformat() + 'Z',
            'uptime_seconds': time.time() - _start_time,
        }), 200
    finally:
        conn.close()


_start_time = time.time()


# ── Staff Management (Admin) ───────────────────────────────────────────────────

@settings_bp.route('/check-username', methods=['GET'])
@require_auth
@require_admin
def check_username():
    """GET /check-username?value=foo  — Check if a username is taken.
    Optional ?exclude_id=<int> to allow the current owner's own username."""
    value      = (request.args.get('value') or '').strip().lower()
    exclude_id = request.args.get('exclude_id', type=int)

    if not value:
        return jsonify({'available': False, 'error': 'Value required'}), 400

    if not re.match(r'^[a-zA-Z0-9_]{4,20}$', value):
        return jsonify({'available': False, 'error':
            'Username must be 4-20 characters: letters, numbers, underscore only'}), 200

    conn = get_db()
    try:
        c = conn.cursor()
        if exclude_id:
            c.execute('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?',
                      (value, exclude_id))
        else:
            c.execute('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', (value,))
        taken = c.fetchone() is not None
        return jsonify({'available': not taken}), 200
    finally:
        conn.close()


@settings_bp.route('/check-email', methods=['GET'])
@require_auth
@require_admin
def check_email():
    """GET /check-email?value=foo@bar.com  — Check if an email is taken.
    Optional ?exclude_id=<int> to allow the current owner's own email."""
    value      = (request.args.get('value') or '').strip().lower()
    exclude_id = request.args.get('exclude_id', type=int)

    if not value:
        return jsonify({'available': False, 'error': 'Value required'}), 400

    if not _SAFE_EMAIL_RE.match(value):
        return jsonify({'available': False, 'error': 'Invalid email format'}), 200

    conn = get_db()
    try:
        c = conn.cursor()
        if exclude_id:
            c.execute('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?',
                      (value, exclude_id))
        else:
            c.execute('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', (value,))
        taken = c.fetchone() is not None
        return jsonify({'available': not taken}), 200
    finally:
        conn.close()


@settings_bp.route('/staff', methods=['GET'])
@require_auth
@require_admin
def list_staff():
    """Return all staff accounts."""
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute(
            '''SELECT id, username, email, fullname, role, active, created_at, last_login
               FROM users ORDER BY created_at DESC'''
        )
        rows = c.fetchall()
        staff = [
            {
                'id':         r['id'],
                'username':   r['username'],
                'email':      r['email'] or '',
                'fullname':   r['fullname'] or '',
                'role':       r['role'] or 'staff',
                'active':     bool(r['active']),
                'created_at': str(r['created_at']) if r['created_at'] else None,
                'last_login': str(r['last_login']) if r.get('last_login') else None,
            }
            for r in rows
        ]
        return jsonify({'staff': staff}), 200
    finally:
        conn.close()


@settings_bp.route('/staff', methods=['POST'])
@require_auth
@require_admin
def create_staff():
    """Create a new staff (or admin) account."""
    admin_uid = request.user['sub']
    data = request.get_json(silent=True) or {}

    username = (data.get('username') or '').strip()
    email    = (data.get('email') or '').strip()
    fullname = (data.get('fullname') or '').strip()
    password = data.get('password') or ''
    role     = data.get('role', 'staff')

    if role not in ('admin', 'staff'):
        role = 'staff'
    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400
    if not _SAFE_USERNAME_RE.match(username):
        return jsonify({'error': 'Invalid username format'}), 400
    if email and not _SAFE_EMAIL_RE.match(email):
        return jsonify({'error': 'Invalid email address'}), 400
    if len(password) < PASSWORD_MIN_LEN:
        return jsonify({'error': f'Password must be at least {PASSWORD_MIN_LEN} characters'}), 400

    pw_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')

    conn = get_db()
    try:
        c = conn.cursor()
        c.execute('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', (username,))
        if c.fetchone():
            return jsonify({'error': 'Username already exists'}), 409

        if email:
            c.execute('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', (email,))
            if c.fetchone():
                return jsonify({'error': 'Email already in use'}), 409

        c.execute(
            '''INSERT INTO users (username, email, fullname, password_hash, role, active)
               VALUES (?, ?, ?, ?, ?, 1)''',
            (username, email or None, fullname or None, pw_hash, role),
        )
        new_id = c.lastrowid
        conn.commit()

        _log_audit(conn, admin_uid, 'CREATE_STAFF', 'users', str(new_id),
                   f'Created {role} account: {username}')
        conn.commit()

        return jsonify({'message': 'Account created', 'id': new_id}), 201
    finally:
        conn.close()


@settings_bp.route('/staff/<int:uid>', methods=['PUT'])
@require_auth
@require_admin
def update_staff(uid):
    """Update a staff account's fullname, email, and role."""
    admin_uid = request.user['sub']
    data = request.get_json(silent=True) or {}

    fullname = (data.get('fullname') or '').strip()
    email    = (data.get('email') or '').strip()
    role     = data.get('role', '')

    if email and not _SAFE_EMAIL_RE.match(email):
        return jsonify({'error': 'Invalid email address'}), 400
    if role and role not in ('admin', 'staff'):
        return jsonify({'error': 'Invalid role'}), 400

    conn = get_db()
    try:
        c = conn.cursor()
        c.execute('SELECT id FROM users WHERE id = ?', (uid,))
        if not c.fetchone():
            return jsonify({'error': 'User not found'}), 404

        fields, values = [], []
        if fullname is not None:
            fields.append('fullname = ?'); values.append(fullname or None)
        if email:
            fields.append('email = ?'); values.append(email)
        if role:
            fields.append('role = ?'); values.append(role)
        if not fields:
            return jsonify({'error': 'No fields to update'}), 400

        fields.append('updated_at = NOW()')
        values.append(uid)
        c.execute(f'UPDATE users SET {", ".join(fields)} WHERE id = ?', values)
        conn.commit()

        _log_audit(conn, admin_uid, 'UPDATE_STAFF', 'users', str(uid))
        conn.commit()
        return jsonify({'message': 'Account updated'}), 200
    finally:
        conn.close()


@settings_bp.route('/staff/<int:uid>/toggle', methods=['POST'])
@require_auth
@require_admin
def toggle_staff(uid):
    """Activate or deactivate a staff account."""
    admin_uid = request.user['sub']

    if uid == admin_uid:
        return jsonify({'error': 'Cannot deactivate your own account'}), 400

    conn = get_db()
    try:
        c = conn.cursor()
        c.execute('SELECT active, username FROM users WHERE id = ?', (uid,))
        row = c.fetchone()
        if not row:
            return jsonify({'error': 'User not found'}), 404

        new_state = 0 if row['active'] else 1
        c.execute('UPDATE users SET active = ?, updated_at = NOW() WHERE id = ?',
                  (new_state, uid))
        conn.commit()

        action = 'ACTIVATE_STAFF' if new_state else 'DEACTIVATE_STAFF'
        _log_audit(conn, admin_uid, action, 'users', str(uid), row['username'])
        conn.commit()

        return jsonify({'message': 'Account status updated', 'active': bool(new_state)}), 200
    finally:
        conn.close()


# ── Audit Logs (Admin) ────────────────────────────────────────────────────────

@settings_bp.route('/audit-logs', methods=['GET'])
@require_auth
@require_admin
def get_audit_logs():
    """Return paginated audit logs for all users."""
    page  = max(1, int(request.args.get('page', 1)))
    limit = min(100, max(1, int(request.args.get('limit', 20))))
    offset = (page - 1) * limit

    conn = get_db()
    try:
        c = conn.cursor()
        c.execute(
            '''SELECT al.id, al.action, al.object_type, al.details, al.created_at,
                      u.username
               FROM audit_logs al
               LEFT JOIN users u ON u.id = al.user_id
               ORDER BY al.created_at DESC
               LIMIT ? OFFSET ?''',
            (limit, offset),
        )
        rows = c.fetchall()

        c.execute('SELECT COUNT(*) AS cnt FROM audit_logs')
        total = c.fetchone()['cnt']

        logs = [
            {
                'id':          r['id'],
                'action':      r['action'],
                'object_type': r['object_type'],
                'details':     r['details'],
                'username':    r['username'] or 'system',
                'created_at':  str(r['created_at']),
            }
            for r in rows
        ]
        return jsonify({'logs': logs, 'total': total, 'page': page, 'limit': limit}), 200
    finally:
        conn.close()


# ── Session Management ────────────────────────────────────────────────

@settings_bp.route('/sessions', methods=['GET'])
@require_auth
def list_sessions():
    """
    GET /api/v1/settings/sessions
    Return active sessions for the current user.
    The calling session (matched by jti in the JWT) is marked is_current=True.
    """
    uid         = request.user['sub']
    current_jti = request.user.get('jti', '')

    conn = get_db()
    try:
        c = conn.cursor()
        c.execute(
            '''SELECT id, session_token, ip_address, device, created_at, last_seen, is_active
               FROM user_sessions
               WHERE user_id = ? AND is_active = 1
               ORDER BY last_seen DESC
               LIMIT 20''',
            (uid,)
        )
        rows = c.fetchall()
        sessions = [
            {
                'id':         r['id'],
                'ip_address': r['ip_address'] or 'Unknown',
                'device':     r['device'] or 'Unknown device',
                'created_at': str(r['created_at']),
                'last_seen':  str(r['last_seen']),
                'is_current': r['session_token'] == current_jti,
            }
            for r in rows
        ]
        return jsonify({'sessions': sessions}), 200
    finally:
        conn.close()


@settings_bp.route('/sessions/<int:session_id>', methods=['DELETE'])
@require_auth
def revoke_session(session_id):
    """
    DELETE /api/v1/settings/sessions/<id>
    Revoke (deactivate) a specific session belonging to the current user.
    The current session cannot be revoked via this endpoint (use logout instead).
    """
    uid         = request.user['sub']
    current_jti = request.user.get('jti', '')

    conn = get_db()
    try:
        c = conn.cursor()
        # Verify the session belongs to this user
        c.execute(
            'SELECT id, session_token FROM user_sessions WHERE id = ? AND user_id = ?',
            (session_id, uid)
        )
        sess = c.fetchone()
        if not sess:
            return jsonify({'error': 'Session not found'}), 404
        if sess['session_token'] == current_jti:
            return jsonify({'error': 'Cannot revoke the current session. Use logout instead.'}), 400

        c.execute(
            'UPDATE user_sessions SET is_active = 0 WHERE id = ?',
            (session_id,)
        )
        conn.commit()
        _log_audit(conn, uid, 'REVOKE_SESSION', 'user_sessions', str(session_id))
        conn.commit()
        return jsonify({'message': 'Session revoked'}), 200
    finally:
        conn.close()


@settings_bp.route('/sessions/logout-all', methods=['POST'])
@require_auth
def logout_all_sessions():
    """
    POST /api/v1/settings/sessions/logout-all
    Invalidate ALL sessions for the current user by updating sessions_invalidated_at.
    The current session remains valid so the user stays logged in.
    """
    uid         = request.user['sub']
    current_jti = request.user.get('jti', '')

    conn = get_db()
    try:
        c = conn.cursor()
        # Deactivate all sessions except the current one
        c.execute(
            '''UPDATE user_sessions
               SET is_active = 0
               WHERE user_id = ? AND session_token != ?''',
            (uid, current_jti)
        )
        # Set invalidation timestamp so old JWTs (without jti tracking) are also blocked
        c.execute(
            'UPDATE users SET sessions_invalidated_at = NOW() WHERE id = ?',
            (uid,)
        )
        conn.commit()
        _log_audit(conn, uid, 'LOGOUT_ALL_SESSIONS', 'users', str(uid))
        conn.commit()
        return jsonify({'message': 'All other sessions have been logged out'}), 200
    finally:
        conn.close()


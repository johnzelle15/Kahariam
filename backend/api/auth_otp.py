"""
Authentication API — Login + Email OTP verification.

Flow:
  1. POST /api/v1/auth/login   → validate username/password, send OTP via email
  2. POST /api/v1/auth/verify-otp → verify OTP, return JWT
  3. GET  /api/v1/auth/me      → return current user from JWT
  4. POST /api/v1/auth/logout   → client-side token discard (no-op server-side)
"""

import hashlib
import hmac
import os
import random
import re
import secrets
import smtplib
import string
import threading
import uuid
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from functools import wraps

import bcrypt
import jwt
from flask import Blueprint, jsonify, request

from backend.core.db import get_db

auth_bp = Blueprint('auth', __name__, url_prefix='/api/v1/auth')

# ── Config ────────────────────────────────────────────────────────────────────

JWT_SECRET = os.environ.get('JWT_SECRET', 'change-me-in-production')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRY_HOURS = int(os.environ.get('JWT_EXPIRY_HOURS', '8'))

OTP_LENGTH = 6
OTP_EXPIRY_MINUTES = 5
OTP_MAX_ATTEMPTS = 3

# ── TESTING ONLY ──────────────────────────────────────────────────────────────
# In production, remove this and always send OTP to the user's own email.
ADMIN_TEST_EMAIL = 'johnzelle.gabalones@gmail.com'

EMAIL_USER = os.environ.get('EMAIL_USER', '')
EMAIL_PASS = os.environ.get('EMAIL_PASS', '')
EMAIL_SMTP_HOST = os.environ.get('EMAIL_SMTP_HOST', 'smtp.gmail.com')
EMAIL_SMTP_PORT = int(os.environ.get('EMAIL_SMTP_PORT', '587'))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash_otp(code: str) -> str:
    """SHA-256 hash of the OTP code for safe DB storage."""
    return hashlib.sha256(code.encode('utf-8')).hexdigest()


def _generate_otp() -> str:
    """Generate a cryptographically random 6-digit OTP."""
    return ''.join(random.SystemRandom().choices(string.digits, k=OTP_LENGTH))


def _resolve_otp_email(role: str, user_email: str) -> str:
    """
    Determine where to send the OTP.

    SYSTEM RULE:
      - admin → ADMIN_TEST_EMAIL (testing only; in production send to user's real email)
      - staff → the email stored in the database
    """
    if role == 'admin':
        # TESTING: all admin OTPs go to the hardcoded test address.
        # TODO: In production, send to the user's own email instead.
        return ADMIN_TEST_EMAIL
    return user_email


def _send_otp_email(to_email: str, otp_code: str, username: str) -> None:
    """Send OTP via SMTP. Raises on failure."""
    if not EMAIL_USER or not EMAIL_PASS:
        raise RuntimeError('EMAIL_USER and EMAIL_PASS must be set in environment')

    msg = MIMEMultipart('alternative')
    msg['From'] = EMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = 'Fish Counter — Your Login OTP'

    text_body = (
        f"Hi {username},\n\n"
        f"Your one-time login code is: {otp_code}\n\n"
        f"This code expires in {OTP_EXPIRY_MINUTES} minutes.\n"
        f"If you did not request this, please ignore this email.\n"
    )

    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;
                padding: 32px; background: #0a0c16; color: #e8ecf2; border-radius: 16px;">
      <h2 style="color: #a78bfa; margin-bottom: 8px;">Fish Counter</h2>
      <p>Hi <strong>{username}</strong>,</p>
      <p>Your one-time login code is:</p>
      <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; text-align: center;
                  padding: 20px; margin: 16px 0; background: #0e1220; border-radius: 12px;
                  border: 1px solid rgba(255,255,255,0.06); color: #60a5fa;">
        {otp_code}
      </div>
      <p style="color: #8b95a8; font-size: 14px;">
        This code expires in <strong>{OTP_EXPIRY_MINUTES} minutes</strong>.<br>
        If you did not request this, please ignore this email.
      </p>
    </div>
    """

    msg.attach(MIMEText(text_body, 'plain'))
    msg.attach(MIMEText(html_body, 'html'))

    with smtplib.SMTP(EMAIL_SMTP_HOST, EMAIL_SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(EMAIL_USER, EMAIL_PASS)
        server.sendmail(EMAIL_USER, to_email, msg.as_string())


def _create_jwt(user_id: int, username: str, role: str) -> tuple:
    """Issue a signed JWT. Returns (token_string, jti)."""
    jti = str(uuid.uuid4())
    payload = {
        'sub':      str(user_id),   # PyJWT requires sub to be a string
        'uid':      user_id,        # keep integer separately for easy access
        'username': username,
        'role':     role,
        'jti':      jti,
        'iat':      datetime.utcnow(),
        'exp':      datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM), jti


def require_auth(f):
    """Decorator: validates JWT, checks session invalidation (logout-all)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing or invalid authorization header'}), 401
        token = auth_header[7:]
        try:
            payload = jwt.decode(
                token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
                options={'verify_sub': False},  # allow both str and int sub (backward compat)
            )
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401

        # ── Session-invalidation checks ───────────────────────────────────
        user_id = payload.get('sub')
        jti     = payload.get('jti')
        iat     = payload.get('iat')  # seconds since epoch

        if user_id:
            try:
                conn = get_db()
                try:
                    c = conn.cursor()
                    # 1. Logout-all-devices: check sessions_invalidated_at
                    c.execute(
                        'SELECT sessions_invalidated_at FROM users WHERE id = ?',
                        (user_id,)
                    )
                    row = c.fetchone()
                    if row and row.get('sessions_invalidated_at') and iat:
                        invalidated = row['sessions_invalidated_at']
                        if isinstance(invalidated, str):
                            invalidated = datetime.strptime(invalidated, '%Y-%m-%d %H:%M:%S')
                        issued_at = datetime.utcfromtimestamp(iat)
                        if issued_at < invalidated:
                            return jsonify({'error': 'Session invalidated. Please log in again.'}), 401
                    # 2. Individual session revocation (only for tokens with jti)
                    if jti:
                        c.execute(
                            'SELECT is_active FROM user_sessions WHERE session_token = ?',
                            (jti,)
                        )
                        sess = c.fetchone()
                        if sess is not None and not sess.get('is_active'):
                            return jsonify({'error': 'Session revoked. Please log in again.'}), 401
                finally:
                    conn.close()
            except Exception:
                pass  # auth DB check failure must never block access
        # ─────────────────────────────────────────────────────────────────

        request.user = payload
        # Normalize sub to integer so all downstream handlers get a consistent type.
        # New tokens store an integer in 'uid'; old tokens may have integer or string 'sub'.
        try:
            payload['sub'] = int(payload.get('uid', payload.get('sub', 0)))
        except (TypeError, ValueError):
            pass
        return f(*args, **kwargs)
    return decorated


# ── Endpoints ─────────────────────────────────────────────────────────────────

@auth_bp.route('/login', methods=['POST'])
def login():
    """
    POST /api/v1/auth/login
    Body: { "username": "...", "password": "..." }

    Accepts username OR email in the 'username' field.
    Validates credentials, generates OTP, emails it, returns 200 with user_id.
    Does NOT return the OTP in the response.
    """
    data = request.get_json(silent=True) or {}
    identifier = (data.get('username') or '').strip()
    password   = data.get('password') or ''

    if not identifier or not password:
        return jsonify({'error': 'Username and password are required'}), 400

    conn = get_db()
    try:
        c = conn.cursor()
        # Accept login by username OR email (case-insensitive email match)
        c.execute(
            '''SELECT id, username, password_hash, email, role, active
               FROM users
               WHERE username = ? OR LOWER(email) = LOWER(?)
               LIMIT 1''',
            (identifier, identifier)
        )
        user = c.fetchone()

        if not user:
            return jsonify({'error': 'Invalid credentials'}), 401

        if not user.get('active', 1):
            return jsonify({'error': 'Account is disabled'}), 403

        # Verify password — guard against empty/null hash in DB
        stored_hash = user.get('password_hash') or ''
        if not stored_hash:
            return jsonify({'error': 'Account configuration error. Contact an administrator.'}), 500

        try:
            pw_matches = bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8'))
        except Exception as e:
            print(f'[AUTH] bcrypt error for user {user.get("username")}: {e}')
            return jsonify({'error': 'Invalid credentials'}), 401

        if not pw_matches:
            return jsonify({'error': 'Invalid credentials'}), 401

        user_id = user['id']
        username = user['username']
        role  = user.get('role', 'staff')
        email = user.get('email', '')

        # Invalidate any existing unused OTPs for this user
        c.execute('UPDATE otp_codes SET used = 1 WHERE user_id = ? AND used = 0', (user_id,))

        # Generate & store OTP
        otp_code = _generate_otp()
        otp_hash = _hash_otp(otp_code)
        expires_at = datetime.utcnow() + timedelta(minutes=OTP_EXPIRY_MINUTES)

        c.execute(
            'INSERT INTO otp_codes (user_id, otp_code, expires_at) VALUES (?, ?, ?)',
            (user_id, otp_hash, expires_at.strftime('%Y-%m-%d %H:%M:%S'))
        )
        conn.commit()

        # Determine recipient email and send
        recipient = _resolve_otp_email(role, email)
        if not recipient:
            return jsonify({'error': 'No email address configured for this account'}), 500

        try:
            _send_otp_email(recipient, otp_code, username)
        except Exception as e:
            print(f'[AUTH] Failed to send OTP email: {e}')
            return jsonify({'error': 'Failed to send OTP email. Please try again.'}), 500

        # Mask the email for the client
        parts = recipient.split('@')
        masked = parts[0][:2] + '***@' + parts[1] if len(parts) == 2 else '***'

        return jsonify({
            'message': 'OTP sent',
            'user_id': user_id,
            'email_hint': masked,
            'expires_in': OTP_EXPIRY_MINUTES * 60,  # seconds
        }), 200

    finally:
        conn.close()


@auth_bp.route('/verify-otp', methods=['POST'])
def verify_otp():
    """
    POST /api/v1/auth/verify-otp
    Body: { "user_id": 1, "otp": "123456" }

    Verifies the OTP, returns JWT on success.
    """
    data = request.get_json(silent=True) or {}
    user_id = data.get('user_id')
    otp_input = (data.get('otp') or '').strip()

    if not user_id or not otp_input:
        return jsonify({'error': 'user_id and otp are required'}), 400

    conn = get_db()
    try:
        c = conn.cursor()

        # Get the latest unused, non-expired OTP for this user
        c.execute(
            '''SELECT id, otp_code, expires_at, attempts
               FROM otp_codes
               WHERE user_id = ? AND used = 0
               ORDER BY created_at DESC LIMIT 1''',
            (user_id,)
        )
        otp_row = c.fetchone()

        if not otp_row:
            return jsonify({'error': 'No active OTP found. Please request a new one.'}), 400

        otp_id = otp_row['id']
        stored_hash = otp_row['otp_code']
        expires_at = otp_row['expires_at']
        attempts = otp_row['attempts']

        # Check max attempts
        if attempts >= OTP_MAX_ATTEMPTS:
            c.execute('UPDATE otp_codes SET used = 1 WHERE id = ?', (otp_id,))
            conn.commit()
            return jsonify({'error': 'Too many attempts. Please request a new OTP.'}), 429

        # Check expiry
        now = datetime.utcnow()
        if isinstance(expires_at, str):
            expires_at = datetime.strptime(expires_at, '%Y-%m-%d %H:%M:%S')
        if now > expires_at:
            c.execute('UPDATE otp_codes SET used = 1 WHERE id = ?', (otp_id,))
            conn.commit()
            return jsonify({'error': 'OTP has expired. Please request a new one.'}), 400

        # Verify OTP (compare hashes)
        input_hash = _hash_otp(otp_input)
        if not hmac.compare_digest(input_hash, stored_hash):
            # Increment attempts
            c.execute('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', (otp_id,))
            conn.commit()
            remaining = OTP_MAX_ATTEMPTS - (attempts + 1)
            return jsonify({
                'error': 'Invalid OTP',
                'attempts_remaining': max(remaining, 0),
            }), 401

        # OTP valid — mark as used
        c.execute('UPDATE otp_codes SET used = 1 WHERE id = ?', (otp_id,))

        # Fetch user for JWT
        c.execute('SELECT id, username, role FROM users WHERE id = ?', (user_id,))
        user = c.fetchone()
        conn.commit()

        if not user:
            return jsonify({'error': 'User not found'}), 404

        token, jti = _create_jwt(user['id'], user['username'], user.get('role', 'staff'))

        # Record login in history, update last_login, and track session
        try:
            xff = request.headers.get('X-Forwarded-For', '')
            ip  = xff.split(',')[0].strip() if xff else (request.remote_addr or '')
            ua  = (request.headers.get('User-Agent') or '')[:255]
            c.execute(
                'INSERT INTO login_history (user_id, ip_address, device, status) VALUES (?, ?, ?, ?)',
                (user['id'], ip, ua, 'success'),
            )
            c.execute('UPDATE users SET last_login = NOW() WHERE id = ?', (user['id'],))
            # Track the new session (best-effort; table may not exist in older deployments)
            c.execute(
                '''INSERT INTO user_sessions (user_id, session_token, ip_address, device, is_active)
                   VALUES (?, ?, ?, ?, 1)''',
                (user['id'], jti, ip, ua),
            )
        except Exception:
            pass  # history/session tracking must not block login

        conn.commit()

        return jsonify({
            'message': 'Authentication successful',
            'token': token,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'role': user.get('role', 'staff'),
            },
        }), 200

    finally:
        conn.close()


@auth_bp.route('/me', methods=['GET'])
@require_auth
def me():
    """GET /api/v1/auth/me — Return current user info from JWT."""
    return jsonify({
        'user': {
            'id': request.user['sub'],
            'username': request.user['username'],
            'role': request.user['role'],
        }
    }), 200


@auth_bp.route('/logout', methods=['POST'])
def logout():
    """POST /api/v1/auth/logout — No-op; client discards token."""
    return jsonify({'message': 'Logged out'}), 200


# ── Forgot / Reset Password ───────────────────────────────────────────────────

RESET_TOKEN_EXPIRY_MINUTES = 30
RESET_RATE_LIMIT_MAX = 3          # max requests per email per window
RESET_RATE_LIMIT_WINDOW_HOURS = 1

# Minimum password requirements
_PW_MIN_LEN = 8
_WEAK_PATTERNS = re.compile(
    r'^(?:password|passw0rd|123456789?|87654321|abcdefg|qwerty|letmein|'
    r'welcome|admin|iloveyou|monkey|dragon|master|sunshine|princess|'
    r'([a-z0-9])\1{5,}|(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|'
    r'lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz)|'
    r'(?:012|123|234|345|456|567|678|789|890)).*$',
    re.IGNORECASE,
)


def _validate_password_strength(password: str) -> str | None:
    """Return an error message if password is weak, else None."""
    if len(password) < _PW_MIN_LEN:
        return f'Password must be at least {_PW_MIN_LEN} characters long'
    if not re.search(r'[A-Z]', password):
        return 'Password must contain at least one uppercase letter'
    if not re.search(r'[a-z]', password):
        return 'Password must contain at least one lowercase letter'
    if not re.search(r'\d', password):
        return 'Password must contain at least one number'
    if not re.search(r'[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?]', password):
        return 'Password must contain at least one special character (!@#$%^&*...)'
    if _WEAK_PATTERNS.match(password):
        return 'Password is too common or follows a predictable pattern'
    return None


def _generate_reset_token() -> tuple[str, str]:
    """Return (raw_token, token_hash). Raw token is sent to user; only hash stored in DB."""
    raw = secrets.token_urlsafe(32)
    hashed = hashlib.sha256(raw.encode('utf-8')).hexdigest()
    return raw, hashed


def _send_reset_email(to_email: str, reset_link: str, expiry_minutes: int) -> None:
    """Send password reset email via SMTP."""
    if not EMAIL_USER or not EMAIL_PASS:
        raise RuntimeError('EMAIL_USER and EMAIL_PASS must be set in environment')

    msg = MIMEMultipart('alternative')
    msg['From'] = f'Aquaculture Management <{EMAIL_USER}>'
    msg['To'] = to_email
    msg['Subject'] = 'Password Reset Request — Aquaculture Management'

    text_body = (
        f"You requested a password reset for your Aquaculture Management account.\n\n"
        f"Click the link below to reset your password (expires in {expiry_minutes} minutes):\n"
        f"{reset_link}\n\n"
        f"This link can only be used once.\n\n"
        f"If you did NOT request a password reset, please ignore this email. "
        f"Your password will remain unchanged.\n\n"
        f"— Aquaculture Management System"
    )

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Password Reset</title>
</head>
<body style="margin:0;padding:0;background:#020617;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background:#020617;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
          style="max-width:480px;background:#0e1220;border-radius:20px;
                 border:1px solid rgba(255,255,255,0.06);overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 0;text-align:center;">
              <div style="display:inline-flex;align-items:center;justify-content:center;
                          width:56px;height:56px;border-radius:16px;margin-bottom:16px;
                          background:linear-gradient(135deg,rgba(52,211,153,0.12),rgba(96,165,250,0.10));
                          border:1px solid rgba(255,255,255,0.08);">
                <!-- Fish SVG -->
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                  stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6.5 12c3-6 11-6 14.5 0-3.5 6-11.5 6-14.5 0z"/>
                  <path d="M3 12c-1.5-2-2-4-1-5.5 2 1 3.5 2.5 4.5 5.5"/>
                  <path d="M3 12c-1.5 2-2 4-1 5.5 2-1 3.5-2.5 4.5-5.5"/>
                  <circle cx="16" cy="12" r="1" fill="#34d399" stroke="none"/>
                </svg>
              </div>
              <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.2em;
                        text-transform:uppercase;color:rgba(52,211,153,0.8);">Aquaculture</p>
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#e8ecf2;">
                Password Reset
              </h1>
              <p style="margin:0;font-size:14px;color:#8b95a8;">
                You requested a password reset for your account.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="padding:24px 32px 0;">
            <div style="height:1px;background:rgba(255,255,255,0.06);"></div>
          </td></tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 32px;">
              <p style="margin:0 0 20px;font-size:14px;color:#c4cad4;line-height:1.6;">
                Click the button below to set a new password. This link expires in
                <strong style="color:#e8ecf2;">{expiry_minutes} minutes</strong>
                and can only be used <strong style="color:#e8ecf2;">once</strong>.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:4px 0 24px;">
                    <a href="{reset_link}"
                      style="display:inline-block;padding:14px 32px;
                             background:linear-gradient(135deg,#059669,#34d399);
                             color:#ffffff;font-size:14px;font-weight:700;
                             text-decoration:none;border-radius:12px;
                             box-shadow:0 4px 16px rgba(52,211,153,0.25);">
                      Reset My Password
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p style="margin:0 0 8px;font-size:12px;color:#8b95a8;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:11px;word-break:break-all;
                        color:#60a5fa;font-family:monospace;">
                {reset_link}
              </p>
            </td>
          </tr>

          <!-- Warning -->
          <tr>
            <td style="padding:0 32px 32px;">
              <div style="background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.12);
                          border-radius:12px;padding:14px 16px;">
                <p style="margin:0;font-size:12px;color:#fbbf24;line-height:1.5;">
                  ⚠️ <strong>Didn't request this?</strong>
                  If you didn't request a password reset, please ignore this email.
                  Your password will remain unchanged. No action is needed.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 28px;text-align:center;
                       border-top:1px solid rgba(255,255,255,0.04);">
              <p style="margin:0;font-size:11px;color:rgba(139,149,168,0.6);">
                This email was sent by Aquaculture Management System.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    msg.attach(MIMEText(text_body, 'plain'))
    msg.attach(MIMEText(html_body, 'html'))

    with smtplib.SMTP(EMAIL_SMTP_HOST, EMAIL_SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(EMAIL_USER, EMAIL_PASS)
        server.sendmail(EMAIL_USER, to_email, msg.as_string())


@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    """
    POST /api/v1/auth/forgot-password
    Body: { "email": "user@example.com" }

    Rate-limited. Always returns the same generic response to prevent
    email enumeration attacks.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()

    if not email or '@' not in email:
        return jsonify({'message': 'If that email is registered, a reset link has been sent.'}), 200

    ip = request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip()

    conn = get_db()
    try:
        c = conn.cursor()

        # ── Rate limiting ─────────────────────────────────────────────────────
        window_start = (datetime.utcnow() - timedelta(hours=RESET_RATE_LIMIT_WINDOW_HOURS)).strftime('%Y-%m-%d %H:%M:%S')
        c.execute(
            'SELECT COUNT(*) AS cnt FROM password_resets WHERE email = ? AND created_at >= ?',
            (email, window_start)
        )
        row = c.fetchone()
        recent_count = int(row['cnt'] if isinstance(row, dict) else row[0]) if row else 0

        if recent_count >= RESET_RATE_LIMIT_MAX:
            # Log attempt but return generic response (no info leak)
            print(f'[AUTH] Rate limit hit for forgot-password: email={email} ip={ip}')
            return jsonify({'message': 'If that email is registered, a reset link has been sent.'}), 200

        # ── Check if email exists ─────────────────────────────────────────────
        c.execute('SELECT id, username, active FROM users WHERE email = ?', (email,))
        user = c.fetchone()

        # Always generate token work to prevent timing attacks
        raw_token, token_hash = _generate_reset_token()
        expires_at = (datetime.utcnow() + timedelta(minutes=RESET_TOKEN_EXPIRY_MINUTES)).strftime('%Y-%m-%d %H:%M:%S')

        # Log the attempt regardless of whether user exists
        c.execute(
            'INSERT INTO password_resets (email, token_hash, expires_at, used, ip_address) VALUES (?, ?, ?, 0, ?)',
            (email, token_hash, expires_at, ip)
        )
        conn.commit()

        if user and user.get('active', 1):
            # Build reset link — use APP_URL from config (LAN IP:port) so links work on any device
            from backend.core.config import APP_URL as _APP_URL
            app_url = _APP_URL.rstrip('/')
            reset_link = f"{app_url}/?reset_token={raw_token}"
            user_id = user['id']

            def _send_in_bg(to, link, mins, uid, sender_ip):
                try:
                    _send_reset_email(to, link, mins)
                    print(f'[AUTH] Password reset email sent to {to} (user_id={uid}) ip={sender_ip}')
                except Exception as exc:
                    print(f'[AUTH] Failed to send reset email to {to}: {exc}')

            threading.Thread(
                target=_send_in_bg,
                args=(email, reset_link, RESET_TOKEN_EXPIRY_MINUTES, user_id, ip),
                daemon=True
            ).start()

        return jsonify({'message': 'If that email is registered, a reset link has been sent.'}), 200

    finally:
        conn.close()


@auth_bp.route('/validate-reset-token', methods=['POST'])
def validate_reset_token():
    """
    POST /api/v1/auth/validate-reset-token
    Body: { "token": "..." }

    Returns 200 if token is valid and unexpired, 400 otherwise.
    Used by the frontend to validate before showing the reset form.
    """
    data = request.get_json(silent=True) or {}
    raw_token = (data.get('token') or '').strip()

    if not raw_token:
        return jsonify({'error': 'Token is required'}), 400

    token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()

    conn = get_db()
    try:
        c = conn.cursor()
        c.execute(
            'SELECT id, expires_at, used FROM password_resets WHERE token_hash = ?',
            (token_hash,)
        )
        record = c.fetchone()

        if not record:
            return jsonify({'error': 'Invalid or expired reset link.'}), 400

        if record['used']:
            return jsonify({'error': 'This reset link has already been used.'}), 400

        expires_at = record['expires_at']
        if isinstance(expires_at, str):
            expires_at = datetime.strptime(expires_at, '%Y-%m-%d %H:%M:%S')
        if datetime.utcnow() > expires_at:
            return jsonify({'error': 'This reset link has expired. Please request a new one.'}), 400

        return jsonify({'valid': True}), 200

    finally:
        conn.close()


@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    """
    POST /api/v1/auth/reset-password
    Body: { "token": "...", "password": "...", "confirm_password": "..." }

    Validates token, checks password strength, updates password, invalidates token.
    """
    data = request.get_json(silent=True) or {}
    raw_token = (data.get('token') or '').strip()
    password = data.get('password') or ''
    confirm_password = data.get('confirm_password') or ''

    if not raw_token:
        return jsonify({'error': 'Token is required'}), 400

    if not password or not confirm_password:
        return jsonify({'error': 'Password and confirmation are required'}), 400

    if password != confirm_password:
        return jsonify({'error': 'Passwords do not match'}), 400

    # Validate password strength
    pw_error = _validate_password_strength(password)
    if pw_error:
        return jsonify({'error': pw_error}), 400

    token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
    ip = request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip()

    conn = get_db()
    try:
        c = conn.cursor()

        c.execute(
            'SELECT id, email, expires_at, used FROM password_resets WHERE token_hash = ?',
            (token_hash,)
        )
        record = c.fetchone()

        if not record:
            return jsonify({'error': 'Invalid or expired reset link.'}), 400

        if record['used']:
            return jsonify({'error': 'This reset link has already been used.'}), 400

        expires_at = record['expires_at']
        if isinstance(expires_at, str):
            expires_at = datetime.strptime(expires_at, '%Y-%m-%d %H:%M:%S')
        if datetime.utcnow() > expires_at:
            return jsonify({'error': 'This reset link has expired. Please request a new one.'}), 400

        email = record['email']
        reset_id = record['id']

        # Fetch user
        c.execute('SELECT id, username FROM users WHERE email = ? AND active = 1', (email,))
        user = c.fetchone()

        if not user:
            # Mark token used to prevent retries, return generic error
            c.execute('UPDATE password_resets SET used = 1 WHERE id = ?', (reset_id,))
            conn.commit()
            return jsonify({'error': 'Invalid or expired reset link.'}), 400

        # Hash new password
        new_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')

        # Update password and mark token as used atomically
        c.execute('UPDATE users SET password_hash = ? WHERE id = ?', (new_hash, user['id']))
        c.execute('UPDATE password_resets SET used = 1 WHERE id = ?', (reset_id,))

        # Invalidate all active OTPs for this user (force re-login)
        c.execute('UPDATE otp_codes SET used = 1 WHERE user_id = ? AND used = 0', (user['id'],))

        conn.commit()

        print(f'[AUTH] Password reset successful for user_id={user["id"]} username={user["username"]} ip={ip}')

        return jsonify({'message': 'Password reset successful. You can now sign in with your new password.'}), 200

    finally:
        conn.close()

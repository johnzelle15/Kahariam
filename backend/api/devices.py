"""
Device registry.

Every route here is admin-only. They previously relied on an optional
ADMIN_API_KEY: the guard read

    admin_key = os.environ.get('ADMIN_API_KEY')
    if admin_key:
        ...check the header...

so when the variable was unset — which it was — the check was skipped
entirely and the endpoints were open. Anyone who could reach the host could
register a device, receive its plaintext ingest token, and post fabricated
counts to /api/v1/ingest, which broadcasts to every connected dashboard.
Authentication is now unconditional and enforced by JWT role, not by whether
an environment variable happens to be present.
"""
import os
import secrets
import uuid
from functools import wraps

import bcrypt
from flask import Blueprint, jsonify, request

from backend.core.db import get_db
from backend.api.auth_otp import require_auth

devices_bp = Blueprint('devices', __name__)


def require_admin(f):
    """Admin-only. Layered on require_auth, which has already validated the JWT."""
    @wraps(f)
    @require_auth
    def decorated(*args, **kwargs):
        if (getattr(request, 'user', None) or {}).get('role') != 'admin':
            return jsonify({'status': 'error', 'message': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated


@devices_bp.route('/api/v1/devices/register', methods=['POST'])
@require_admin
def register_device():
    """Register a device and return its token.

    The token is shown once and only its bcrypt hash is stored, so it cannot
    be recovered later — re-register the device if it is lost.
    """
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or 'device').strip()[:120]

    device_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)
    token_hash = bcrypt.hashpw(token.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    conn = get_db()
    c = conn.cursor()
    c.execute(
        'INSERT INTO devices (id, name, location, model, firmware, secret_hash) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        (device_id, name, data.get('location'), data.get('model'),
         data.get('firmware'), token_hash)
    )
    conn.commit()
    conn.close()

    return jsonify({'device_id': device_id, 'token': token}), 201


@devices_bp.route('/api/v1/devices', methods=['GET'])
@require_admin
def list_devices():
    """Registered devices, without secrets."""
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT id, name, location, model, firmware, last_seen, active, created_at '
              'FROM devices ORDER BY created_at DESC')
    devices = [{
        'id': r['id'],
        'name': r['name'],
        'location': r['location'],
        'model': r['model'],
        'firmware': r['firmware'],
        'last_seen': r['last_seen'],
        'active': bool(r['active']),
        'created_at': r['created_at'],
    } for r in c.fetchall()]
    conn.close()
    return jsonify({'devices': devices})


def _set_active(device_id, active):
    conn = get_db()
    c = conn.cursor()
    c.execute('UPDATE devices SET active = ? WHERE id = ?', (1 if active else 0, device_id))
    changed = c.rowcount
    conn.commit()
    conn.close()
    if not changed:
        return jsonify({'status': 'error', 'message': 'Device not found'}), 404
    return jsonify({'status': 'ok', 'device_id': device_id})


@devices_bp.route('/api/v1/devices/<device_id>/revoke', methods=['POST'])
@require_admin
def revoke_device(device_id):
    return _set_active(device_id, False)


@devices_bp.route('/api/v1/devices/<device_id>/activate', methods=['POST'])
@require_admin
def activate_device(device_id):
    return _set_active(device_id, True)

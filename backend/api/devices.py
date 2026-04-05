from flask import Blueprint, request, jsonify, render_template
from backend.core.db import get_db

devices_bp = Blueprint('devices', __name__)


@devices_bp.route('/api/v1/devices/register', methods=['POST'])
def register_device():
    """Admin endpoint to register a new device and return a plaintext token."""
    admin_key = __import__('os').environ.get('ADMIN_API_KEY')
    if admin_key:
        provided = request.headers.get('X-Admin-Key', '')
        if provided != admin_key:
            return jsonify({'status': 'error', 'message': 'admin auth required'}), 401

    data = request.get_json(silent=True) or {}
    name = data.get('name', 'device')
    location = data.get('location')
    model = data.get('model')
    firmware = data.get('firmware')

    import secrets, uuid
    device_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)
    token_hash = __import__('bcrypt').hashpw(token.encode('utf-8'), __import__('bcrypt').gensalt()).decode('utf-8')

    conn = get_db()
    c = conn.cursor()
    c.execute('INSERT INTO devices (id, name, location, model, firmware, secret_hash) VALUES (?, ?, ?, ?, ?, ?)',
              (device_id, name, location, model, firmware, token_hash))
    conn.commit()
    conn.close()

    return jsonify({'device_id': device_id, 'token': token}), 201


@devices_bp.route('/devices')
def devices_page():
    """Admin UI for managing devices."""
    return render_template('devices.html')


@devices_bp.route('/api/v1/devices', methods=['GET'])
def list_devices():
    """Return JSON list of registered devices (no secrets)."""
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT id, name, location, model, firmware, last_seen, active, created_at FROM devices ORDER BY created_at DESC')
    rows = c.fetchall()
    devices = []
    for r in rows:
        devices.append({
            'id': r['id'],
            'name': r['name'],
            'location': r['location'],
            'model': r['model'],
            'firmware': r['firmware'],
            'last_seen': r['last_seen'],
            'active': bool(r['active']),
            'created_at': r['created_at']
        })
    conn.close()
    return jsonify({'devices': devices})


@devices_bp.route('/api/v1/devices/<device_id>/revoke', methods=['POST'])
def revoke_device(device_id):
    """Revoke (deactivate) a device. Requires admin key if ADMIN_API_KEY is set."""
    admin_key = __import__('os').environ.get('ADMIN_API_KEY')
    if admin_key:
        provided = request.headers.get('X-Admin-Key', '')
        if provided != admin_key:
            return jsonify({'status': 'error', 'message': 'admin auth required'}), 401

    conn = get_db()
    c = conn.cursor()
    c.execute('UPDATE devices SET active = 0 WHERE id = ?', (device_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok', 'device_id': device_id})


@devices_bp.route('/api/v1/devices/<device_id>/activate', methods=['POST'])
def activate_device(device_id):
    admin_key = __import__('os').environ.get('ADMIN_API_KEY')
    if admin_key:
        provided = request.headers.get('X-Admin-Key', '')
        if provided != admin_key:
            return jsonify({'status': 'error', 'message': 'admin auth required'}), 401
    conn = get_db()
    c = conn.cursor()
    c.execute('UPDATE devices SET active = 1 WHERE id = ?', (device_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok', 'device_id': device_id})

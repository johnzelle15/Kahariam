from flask import Blueprint, request, jsonify
import json
from src.core.db import get_db
from src.api.auth import verify_device_token
from src.core.runtime import get_runtime, get_socketio

ingest_bp = Blueprint('ingest', __name__)


@ingest_bp.route('/api/v1/ingest', methods=['POST'])
def ingest():
    """Secure ingest endpoint for device readings.
    Expects Authorization: Bearer <token> and JSON body with at least `count` and optionally `device_id`, `firmware`, `rssi`.
    """
    auth = request.headers.get('Authorization', '')
    token = ''
    if auth.startswith('Bearer '):
        token = auth.replace('Bearer ', '').strip()

    data = request.get_json(silent=True) or {}
    # allow token in body for quick tests
    if not token:
        token = data.get('token') or data.get('device_token') or ''

    device_id = data.get('device_id')
    try:
        count = int(data.get('count', 0))
    except Exception:
        return jsonify({'status': 'error', 'message': 'invalid count'}), 400

    if count <= 0:
        return jsonify({'status': 'error', 'message': 'count must be > 0'}), 400

    verified_device = verify_device_token(token, device_id=device_id)
    if not verified_device:
        return jsonify({'status': 'error', 'message': 'unauthorized'}), 401

    # persist reading in SQLite readings table
    conn = get_db()
    c = conn.cursor()
    firmware = data.get('firmware')
    rssi = data.get('rssi')
    raw = json.dumps(data)
    c.execute('INSERT INTO readings (device_id, count, timestamp, firmware, raw_payload, rssi) VALUES (?, ?, ?, ?, ?, ?)',
              (verified_device, count, __import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S'), firmware, raw, rssi))
    c.execute('UPDATE devices SET last_seen = ? WHERE id = ?', (__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S'), verified_device))
    conn.commit()

    runtime = get_runtime()
    socketio = get_socketio()

    # emit real-time event for connected dashboards
    try:
        socketio.emit('reading', {'device_id': verified_device, 'count': count, 'timestamp': __import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')})
    except Exception:
        pass

    runtime.fish_count = count

    conn.close()

    return jsonify({'status': 'ok', 'device_id': verified_device, 'received': count}), 201

from flask import Blueprint, request, jsonify
from datetime import datetime, timedelta
from src.core.db import get_db

locks_bp = Blueprint('locks', __name__)


def _value(row, key, index=0):
    if row is None:
        return None
    if isinstance(row, dict):
        return row.get(key)
    try:
        return row[index]
    except Exception:
        try:
            return row[key]
        except Exception:
            return None


def is_device_locked_local(device_id):
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT locked_by, lock_time FROM devices WHERE id = ?', (device_id,))
    row = c.fetchone()
    conn.close()
    locked_by = _value(row, 'locked_by', 0)
    lock_time_val = _value(row, 'lock_time', 1)
    if not row or not locked_by or not lock_time_val:
        return False, None, None
    # lock_time may already be datetime, or a datetime string.
    if isinstance(lock_time_val, datetime):
        lock_time = lock_time_val
        lock_time_str = lock_time_val.strftime('%Y-%m-%d %H:%M:%S')
    else:
        lock_time = datetime.strptime(str(lock_time_val), '%Y-%m-%d %H:%M:%S')
        lock_time_str = str(lock_time_val)
    now = datetime.now()
    if (now - lock_time) > timedelta(minutes=3):
        return False, locked_by, lock_time_str
    return True, locked_by, lock_time_str


@locks_bp.route('/api/v1/devices/<device_id>/lock', methods=['POST'])
def lock_device(device_id):
    user_id = (request.json or {}).get('user_id') or request.headers.get('X-User-Id')
    if not user_id:
        return jsonify({'status': 'error', 'message': 'user_id required'}), 400
    locked, locked_by, lock_time = is_device_locked_local(device_id)
    if locked:
        return jsonify({'status': 'locked', 'locked_by': locked_by, 'lock_time': lock_time}), 423
    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db()
    c = conn.cursor()
    c.execute('UPDATE devices SET locked_by=?, lock_time=? WHERE id=?', (user_id, now_str, device_id))
    conn.commit()
    conn.close()
    return jsonify({'status': 'ok', 'locked_by': user_id, 'lock_time': now_str})


@locks_bp.route('/api/v1/devices/<device_id>/unlock', methods=['POST'])
def unlock_device(device_id):
    user_id = (request.json or {}).get('user_id') or request.headers.get('X-User-Id')
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT locked_by, lock_time FROM devices WHERE id=?', (device_id,))
    row = c.fetchone()
    locked_by = _value(row, 'locked_by', 0)
    lock_time_val = _value(row, 'lock_time', 1)
    if not row or not locked_by:
        conn.close()
        return jsonify({'status': 'ok', 'message': 'already unlocked'})
    if isinstance(lock_time_val, datetime):
        lock_time = lock_time_val
    else:
        lock_time = datetime.strptime(str(lock_time_val), '%Y-%m-%d %H:%M:%S')
    now = datetime.now()
    expired = (now - lock_time) > timedelta(minutes=3)
    if locked_by == user_id or expired:
        c.execute('UPDATE devices SET locked_by=NULL, lock_time=NULL WHERE id=?', (device_id,))
        conn.commit()
        conn.close()
        return jsonify({'status': 'ok', 'message': 'unlocked'})
    conn.close()
    return jsonify({'status': 'error', 'message': 'not allowed'}), 403


@locks_bp.route('/api/v1/devices/<device_id>/lock_status', methods=['GET'])
def device_lock_status(device_id):
    locked, locked_by, lock_time = is_device_locked_local(device_id)
    return jsonify({'locked': locked, 'locked_by': locked_by, 'lock_time': lock_time})

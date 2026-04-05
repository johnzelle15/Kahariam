import bcrypt

from src.core.db import get_db


def verify_device_token(token, device_id=None):
    """Verify device token using devices table. Returns device_id on success or None."""
    if not token:
        return None

    conn = get_db()
    c = conn.cursor()

    if device_id:
        c.execute('SELECT id, secret_hash FROM devices WHERE id = ? AND active = 1', (device_id,))
        row = c.fetchone()
        if row:
            try:
                if bcrypt.checkpw(token.encode('utf-8'), row['secret_hash'].encode('utf-8')):
                    conn.close()
                    return row['id']
            except Exception:
                pass
    else:
        c.execute('SELECT id, secret_hash FROM devices WHERE active = 1')
        for row in c.fetchall():
            try:
                if bcrypt.checkpw(token.encode('utf-8'), row['secret_hash'].encode('utf-8')):
                    conn.close()
                    return row['id']
            except Exception:
                continue

    conn.close()
    return None

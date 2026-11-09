"""The local counter must be registered, or the Counter screen is dead.

Regression guard for the failure where `devices` was empty. Two things broke at
once, both silently:

  * reserving the counter returned 404, so pressing Start never reached /start
    — no detector process, no preview window, nothing but a toast that faded;
  * vision/fish_counter.py's readings were rejected as unauthorized, so the
    count on screen never moved off zero.

init_db() seeds the row from DEVICE_ID/DEVICE_TOKEN. This checks it actually
did, and that the token the detector sends is the one the database will accept.

Run:  ./.venv/bin/python tests/test_api/test_local_device_registered.py
"""
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv

load_dotenv(_ROOT / '.env')

from backend.core.db import get_db, init_db          # noqa: E402
from backend.api.auth import verify_device_token     # noqa: E402


def test_local_device_is_registered_and_its_token_verifies():
    device_id = (os.environ.get('DEVICE_ID') or '').strip()
    device_token = (os.environ.get('DEVICE_TOKEN') or '').strip()
    assert device_id, 'DEVICE_ID is not set in .env'
    assert device_token, 'DEVICE_TOKEN is not set in .env'

    init_db()

    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT id FROM devices WHERE id = ?', (device_id,))
    row = c.fetchone()
    conn.close()
    assert row, (
        f'{device_id} has no row in `devices` — reserving the counter will 404 '
        'and Start will never reach /start'
    )

    assert verify_device_token(device_token, device_id=device_id) == device_id, (
        'DEVICE_TOKEN does not verify against the stored hash — the detector\'s '
        'readings will be rejected and the count will stay at zero'
    )


if __name__ == '__main__':
    test_local_device_is_registered_and_its_token_verifies()
    print('OK: the local counter is registered and its token verifies')

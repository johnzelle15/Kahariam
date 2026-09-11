"""The Reports endpoint, and the dashboard not counting a death as a sale.

Both run against a throwaway SQLite file standing in for MariaDB, so nothing
here reads or writes live farm data.

  * /api/reports/data is admin-only, rejects a malformed date, and returns the
    opening stock plus every row in the range. The Reports tab builds all four
    of its reports from that one payload.
  * /api/daily-trend used to decide what was a death by looking for a 'Died.'
    note prefix that nothing writes — deaths are stored as
    transaction_type='DIED' — so a recorded death came out as a sale and as
    revenue on the dashboard. A death must still draw the stock down.

Run:  ./.venv/bin/python tests/test_api/test_reports.py
"""
import os
import sqlite3
import sys
import tempfile
import traceback
from datetime import date, timedelta
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv

load_dotenv(_ROOT / '.env')

from flask import Flask                     # noqa: E402
import backend.api.auth_otp as auth_otp     # noqa: E402
import backend.api.inventory as inventory   # noqa: E402

_DB = os.path.join(tempfile.mkdtemp(), 'reports-test.sqlite')

# Every date is in the past, so no range gets capped at today.
D = date.today() - timedelta(days=3)


def day(offset, hhmmss='09:00:00'):
    return f'{(D + timedelta(days=offset)).isoformat()} {hhmmss}'


def _connect():
    conn = sqlite3.connect(_DB)
    conn.row_factory = lambda cur, row: {d[0]: v for d, v in zip(cur.description, row)}
    return conn


def _seed(rows, sessions=()):
    """rows: (signed count, date, notes, transaction_type, deleted)."""
    conn = _connect()
    conn.executescript('''
        DROP TABLE IF EXISTS inventory;
        DROP TABLE IF EXISTS counting_sessions;
        CREATE TABLE inventory (
            id INTEGER PRIMARY KEY, count INTEGER, variant TEXT, date TEXT, notes TEXT,
            action TEXT, transaction_type TEXT, price REAL, total_price REAL,
            deleted INTEGER DEFAULT 0, is_archived INTEGER DEFAULT 0);
        CREATE TABLE counting_sessions (
            id INTEGER PRIMARY KEY, username TEXT, started_at TEXT, ended_at TEXT,
            final_count INTEGER, status TEXT);
    ''')
    conn.executemany(
        "INSERT INTO inventory (count, variant, date, notes, action, transaction_type, deleted) "
        "VALUES (?, 'SPIN_20', ?, ?, 'WHOLESALE', ?, ?)", rows)
    conn.executemany(
        'INSERT INTO counting_sessions (username, started_at, ended_at, final_count, status) '
        'VALUES (?, ?, ?, ?, ?)', sessions)
    conn.commit()
    conn.close()


def _client(*extra_blueprints):
    # Each module holds its own reference to get_db, so each one is pointed at
    # the throwaway file. auth_otp's session check then fails on the missing
    # users table, which require_auth deliberately lets through.
    auth_otp.get_db = _connect
    inventory.get_db = _connect
    app = Flask(__name__)
    for bp in (inventory.inventory_bp, *extra_blueprints):
        app.register_blueprint(bp)
    return app.test_client()


def _reports_client():
    from backend.api import reports
    reports.get_db = _connect
    return _client(reports.reports_bp)


def _auth(role='admin'):
    token, _ = auth_otp._create_jwt(1, 'tester', role)
    return {'Authorization': f'Bearer {token}'}


def test_daily_trend_counts_a_death_against_stock_but_not_as_a_sale():
    _seed([
        (1000, day(-5), 'stocked', 'WHOLESALE_IN', 0),
        (-100, day(0), 'order', 'SOLD', 0),
        (-30, day(0), 'pond 2', 'DIED', 0),
    ])
    r = _client().get(f'/api/daily-trend?start_date={D}&end_date={D}', headers=_auth())
    row = r.get_json()['data'][0]
    assert row['sold_total'] == 100, row
    assert row['revenue'] == round(100 * inventory.PRICE_PER_FISH, 2), row
    assert row['stock_wholesale'] == 870, row


def test_reports_data_returns_opening_stock_and_the_rows_in_range():
    _seed([
        (1000, day(-5), 'stocked', 'WHOLESALE_IN', 0),
        (-50, day(-4), 'earlier order', 'SOLD', 0),
        (-100, day(0), 'order', 'SOLD', 0),
        (-30, day(1), 'pond 2', 'DIED', 0),
        (-999, day(1), 'deleted row', 'SOLD', 1),
        (-7, day(3), 'after the range', 'SOLD', 0),
    ], sessions=[
        ('ana', day(0), day(0, '09:30:00'), 1200, 'saved'),
        ('ben', day(-4), None, 0, 'aborted'),
    ])
    end = D + timedelta(days=1)
    client = _reports_client()
    r = client.get(f'/api/reports/data?start_date={D}&end_date={end}', headers=_auth())
    assert r.status_code == 200, r.get_data(as_text=True)
    body = r.get_json()
    assert (body['start_date'], body['end_date']) == (D.isoformat(), end.isoformat()), body
    assert body['opening_stock'] == 950, body
    assert [(x['transaction_type'], x['count']) for x in body['records']] == [('SOLD', 100), ('DIED', 30)], body
    assert [s['username'] for s in body['sessions']] == ['ana'], body
    assert body['price_per_fish'] == inventory.PRICE_PER_FISH, body

    # A reversed pair is the same range.
    swapped = client.get(f'/api/reports/data?start_date={end}&end_date={D}', headers=_auth()).get_json()
    assert swapped['records'] == body['records'], swapped


def test_reports_data_is_admin_only():
    _seed([])
    r = _reports_client().get('/api/reports/data', headers=_auth('staff'))
    assert r.status_code == 403, r.status_code


def test_reports_data_rejects_a_malformed_date():
    _seed([])
    client = _reports_client()
    for query in ('start_date=2026-13-45&end_date=2026-09-01',
                  'start_date=yesterday&end_date=2026-09-01',
                  'start_date=2026-09-01'):
        r = client.get(f'/api/reports/data?{query}', headers=_auth())
        assert r.status_code == 400, (query, r.status_code)


if __name__ == '__main__':
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith('test_') and callable(fn):
            try:
                fn()
                print('PASS', name)
            except Exception:
                failed += 1
                print('FAIL', name)
                traceback.print_exc()
    sys.exit(1 if failed else 0)

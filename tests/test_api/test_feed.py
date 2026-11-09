"""The feed purchasing alert, and the purchases it is worked out from.

Runs against a throwaway SQLite file standing in for MariaDB, so nothing here
reads or writes live farm data.

  * feed_status() turns the latest purchase date into normal / approaching /
    due / overdue, with no history as its own state, and never rolls a
    skipped purchase's due date forward.
  * The API recalculates from the latest purchase *by date* on every write, so
    backfilling an old purchase leaves the alert alone while correcting or
    deleting the latest one moves it.
  * Writes are admin-only and reject dates and amounts that aren't real.

Run:  ./.venv/bin/python tests/test_api/test_feed.py
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
from backend.api import feed                # noqa: E402

_DB = os.path.join(tempfile.mkdtemp(), 'feed-test.sqlite')
TODAY = date.today()


def ago(days):
    return (TODAY - timedelta(days=days)).isoformat()


def _connect():
    conn = sqlite3.connect(_DB)
    conn.row_factory = lambda cur, row: {d[0]: v for d, v in zip(cur.description, row)}
    return conn


def _client():
    conn = _connect()
    conn.executescript('''
        DROP TABLE IF EXISTS feed_purchases;
        CREATE TABLE feed_purchases (
            id INTEGER PRIMARY KEY, purchased_on TEXT NOT NULL, amount REAL NOT NULL,
            notes TEXT, deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    ''')
    conn.close()
    # auth_otp's session check fails on the missing users table, which
    # require_auth deliberately lets through; the audit insert fails the same
    # way and _log_audit swallows it.
    auth_otp.get_db = _connect
    feed.get_db = _connect
    app = Flask(__name__)
    app.register_blueprint(feed.feed_bp)
    return app.test_client()


def _auth(role='admin'):
    token, _ = auth_otp._create_jwt(1, 'tester', role)
    return {'Authorization': f'Bearer {token}'}


def _post(client, purchased_on, amount=20000, notes=''):
    return client.post('/api/v1/feed/purchases', headers=_auth(),
                       json={'purchased_on': purchased_on, 'amount': amount, 'notes': notes})


def _status_on(days_ago, interval=14, warning=3):
    last = {'id': 1, 'purchased_on': ago(days_ago), 'amount': 19500.0, 'notes': ''}
    return feed.feed_status(last, TODAY, interval, warning, 20000.0)


def test_status_follows_the_countdown():
    cases = [
        # days since last purchase -> (status, days remaining, cycles missed)
        (0, ('normal', 14, 0)),
        (10, ('normal', 4, 0)),
        (11, ('approaching', 3, 0)),   # the warning boundary is inclusive
        (13, ('approaching', 1, 0)),
        (14, ('due', 0, 0)),
        (15, ('overdue', -1, 0)),
        (28, ('overdue', -14, 1)),     # one whole purchase skipped
        (45, ('overdue', -31, 2)),
        (-3, ('normal', 17, 0)),       # Pi clock behind a recorded date
    ]
    for days_ago, expected in cases:
        s = _status_on(days_ago)
        assert (s['status'], s['days_remaining'], s['cycles_missed']) == expected, (days_ago, s)
        assert s['days_since_last'] == days_ago, s
        assert s['estimated_amount'] == 20000.0 and s['last_purchase']['amount'] == 19500.0, s

    # The due date is the day the feed was needed, however late it now is.
    assert _status_on(30)['next_purchase_on'] == ago(16)


def test_status_with_no_warning_window_goes_straight_to_due():
    assert _status_on(13, warning=0)['status'] == 'normal'
    assert _status_on(14, warning=0)['status'] == 'due'


def test_status_with_no_history():
    s = feed.feed_status(None, TODAY)
    assert s['status'] == 'no_history', s
    assert (s['last_purchase'], s['next_purchase_on'], s['days_remaining']) == (None, None, None), s


def test_recording_a_purchase_clears_the_alert():
    client = _client()
    assert client.get('/api/v1/feed/status', headers=_auth()).get_json()['status'] == 'no_history'

    r = _post(client, ago(20), 19800)
    assert r.status_code == 201, r.get_data(as_text=True)
    assert r.get_json()['status']['status'] == 'overdue', r.get_json()

    r = _post(client, TODAY.isoformat(), '20500.555', '  Bag count 40  ')
    body = r.get_json()
    assert r.status_code == 201, body
    assert body['purchase']['amount'] == 20500.56 and body['purchase']['notes'] == 'Bag count 40', body
    assert body['status']['status'] == 'normal' and body['status']['days_remaining'] == 14, body


def test_backfilling_an_older_purchase_leaves_the_alert_alone():
    client = _client()
    latest = _post(client, ago(12)).get_json()['purchase']
    r = _post(client, ago(26), 18000)
    status = r.get_json()['status']
    assert status['status'] == 'approaching' and status['last_purchase']['id'] == latest['id'], status

    listing = client.get('/api/v1/feed/purchases', headers=_auth()).get_json()
    assert [p['purchased_on'] for p in listing['purchases']] == [ago(12), ago(26)], listing
    assert listing['status']['last_purchase']['id'] == latest['id'], listing


def test_correcting_or_deleting_the_latest_purchase_moves_the_alert():
    client = _client()
    older = _post(client, ago(30)).get_json()['purchase']
    latest = _post(client, ago(2)).get_json()['purchase']

    r = client.put(f"/api/v1/feed/purchases/{latest['id']}", headers=_auth(),
                   json={'purchased_on': ago(14), 'amount': 21000})
    assert r.status_code == 200, r.get_data(as_text=True)
    assert r.get_json()['status']['status'] == 'due', r.get_json()

    # Saving an edit that changes nothing is still a valid edit.
    same = client.put(f"/api/v1/feed/purchases/{latest['id']}", headers=_auth(),
                      json={'purchased_on': ago(14), 'amount': 21000})
    assert same.status_code == 200, same.status_code

    r = client.delete(f"/api/v1/feed/purchases/{latest['id']}", headers=_auth())
    status = r.get_json()['status']
    assert status['status'] == 'overdue' and status['last_purchase']['id'] == older['id'], status

    client.delete(f"/api/v1/feed/purchases/{older['id']}", headers=_auth())
    assert client.get('/api/v1/feed/status', headers=_auth()).get_json()['status'] == 'no_history'
    assert client.get('/api/v1/feed/purchases', headers=_auth()).get_json()['purchases'] == []

    # A deleted purchase can be neither edited nor deleted again.
    for call in (client.put, client.delete):
        r = call(f"/api/v1/feed/purchases/{older['id']}", headers=_auth(),
                 json={'purchased_on': ago(1), 'amount': 1})
        assert r.status_code == 404, (call, r.status_code)
    assert client.delete('/api/v1/feed/purchases/9999', headers=_auth()).status_code == 404


def test_rejects_dates_and_amounts_that_are_not_real():
    client = _client()
    bad = [
        {'purchased_on': '15/09/2026', 'amount': 20000},
        {'purchased_on': '2026-02-30', 'amount': 20000},
        {'purchased_on': (TODAY + timedelta(days=1)).isoformat(), 'amount': 20000},
        {'purchased_on': '1999-12-31', 'amount': 20000},
        {'purchased_on': None, 'amount': 20000},
        {'amount': 20000},
        {'purchased_on': ago(1), 'amount': 0},
        {'purchased_on': ago(1), 'amount': -500},
        {'purchased_on': ago(1), 'amount': 0.004},
        {'purchased_on': ago(1), 'amount': 'abc'},
        {'purchased_on': ago(1), 'amount': 'NaN'},
        {'purchased_on': ago(1), 'amount': 'inf'},
        {'purchased_on': ago(1), 'amount': True},
        {'purchased_on': ago(1), 'amount': 100_000_000},
        {'purchased_on': ago(1)},
        {'purchased_on': ago(1), 'amount': 20000, 'notes': 'x' * 256},
        {'purchased_on': ago(1), 'amount': 20000, 'notes': 42},
    ]
    for body in bad:
        r = client.post('/api/v1/feed/purchases', headers=_auth(), json=body)
        assert r.status_code == 400 and r.get_json()['error'], (body, r.status_code)
    r = client.post('/api/v1/feed/purchases', headers=_auth(), json=[ago(1), 20000])
    assert r.status_code == 400, r.status_code
    assert client.get('/api/v1/feed/purchases', headers=_auth()).get_json()['purchases'] == []


def test_feed_is_admin_only():
    client = _client()
    staff = _auth('staff')
    assert client.get('/api/v1/feed/status', headers=staff).status_code == 403
    assert client.get('/api/v1/feed/purchases', headers=staff).status_code == 403
    r = client.post('/api/v1/feed/purchases', headers=staff, json={'purchased_on': ago(1), 'amount': 1})
    assert r.status_code == 403, r.status_code
    assert client.get('/api/v1/feed/status').status_code == 401


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

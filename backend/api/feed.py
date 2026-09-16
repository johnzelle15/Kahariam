"""
Feed API — feed purchases, and when the next one is due.

Routes (all [Admin]):
  GET    /api/v1/feed/status                — The next-purchase alert
  GET    /api/v1/feed/purchases             — Every purchase, newest first, plus the alert
  POST   /api/v1/feed/purchases             — Record a purchase
  PUT    /api/v1/feed/purchases/<int:id>    — Correct a purchase
  DELETE /api/v1/feed/purchases/<int:id>    — Remove a purchase (soft delete)

The alert is never stored. It is worked out on every read from the latest
purchase date, so recording, correcting or deleting a purchase moves it with
nothing to invalidate. Dates are whole days on the Pi's own clock — the same
local clock that stamps every inventory row — so the countdown cannot shift
with a viewer's timezone or with the hour a purchase was typed in.
"""
import math
import os
from datetime import date, timedelta

from flask import Blueprint, jsonify, request

from backend.api.auth_otp import require_auth
from backend.api.reports import _DATE_RE
from backend.api.settings import _log_audit, require_admin
from backend.core.db import get_db
from backend.core.runtime import get_socketio

feed_bp = Blueprint('feed', __name__, url_prefix='/api/v1/feed')

# The farm buys feed every 14 days, for about ₱20,000 a time.
INTERVAL_DAYS = max(1, int(os.environ.get('FEED_PURCHASE_INTERVAL_DAYS', '14')))
# "Approaching" starts this many days before the due date. Capped below the
# interval, or a fresh purchase would already read as approaching.
WARNING_DAYS = min(max(0, int(os.environ.get('FEED_PURCHASE_WARNING_DAYS', '3'))), INTERVAL_DAYS - 1)
ESTIMATED_AMOUNT = max(0.0, float(os.environ.get('FEED_PURCHASE_ESTIMATED_AMOUNT', '20000')))

MAX_AMOUNT = 99_999_999.99    # decimal(10,2)
MAX_NOTES = 255
EARLIEST = date(2000, 1, 1)   # catches a mistyped year, e.g. 0226

_COLUMNS = 'id, purchased_on, amount, notes'


def _as_date(value):
    """MariaDB returns a date, SQLite (the tests) a 'YYYY-MM-DD' string."""
    if hasattr(value, 'year'):
        return date(value.year, value.month, value.day)
    return date.fromisoformat(str(value)[:10])


def _serialize(row):
    return {
        'id': row['id'],
        'purchased_on': _as_date(row['purchased_on']).isoformat(),
        'amount': float(row['amount']),
        'notes': row['notes'] or '',
    }


def feed_status(last, today, interval=INTERVAL_DAYS, warning=WARNING_DAYS, estimate=ESTIMATED_AMOUNT):
    """The alert for the latest purchase `last` (a serialized row, or None) as of `today`.

    A skipped purchase does not roll the due date forward: the feed was still
    needed on that day, so the alert stays overdue and counts up, and
    `cycles_missed` says how many whole intervals have gone by on top.
    """
    body = {
        'today': today.isoformat(),
        'estimated_amount': estimate,
        'interval_days': interval,
        'warning_days': warning,
        'last_purchase': last,
    }
    if last is None:
        return {**body, 'status': 'no_history', 'next_purchase_on': None,
                'days_remaining': None, 'days_since_last': None, 'cycles_missed': 0}

    bought = date.fromisoformat(last['purchased_on'])
    next_on = bought + timedelta(days=interval)
    days = (next_on - today).days
    if days < 0:
        status = 'overdue'
    elif days == 0:
        status = 'due'
    elif days <= warning:
        status = 'approaching'
    else:
        status = 'normal'
    return {**body, 'status': status, 'next_purchase_on': next_on.isoformat(),
            'days_remaining': days, 'days_since_last': (today - bought).days,
            'cycles_missed': max(0, -days) // interval}


def _status(c):
    """The alert from the latest purchase by date — not the latest one typed in,
    so backfilling an older purchase leaves the countdown where it was."""
    c.execute(f'SELECT {_COLUMNS} FROM feed_purchases WHERE deleted = 0 '
              'ORDER BY purchased_on DESC, id DESC LIMIT 1')
    row = c.fetchone()
    return feed_status(_serialize(row) if row else None, date.today())


def _find(c, purchase_id):
    c.execute(f'SELECT {_COLUMNS} FROM feed_purchases WHERE id = ? AND deleted = 0', (purchase_id,))
    row = c.fetchone()
    return _serialize(row) if row else None


def _parse(data):
    """((purchased_on, amount, notes), None) for a valid body, else (None, message)."""
    if not isinstance(data, dict):
        return None, 'Expected a JSON object'

    raw_date = data.get('purchased_on')
    if not isinstance(raw_date, str) or not _DATE_RE.match(raw_date):
        return None, 'Date must be YYYY-MM-DD'
    try:
        bought = date.fromisoformat(raw_date)
    except ValueError:
        return None, 'Date is not a real calendar date'
    if bought > date.today():
        return None, "Date can't be in the future"
    if bought < EARLIEST:
        return None, f'Date must be on or after {EARLIEST.isoformat()}'

    raw_amount = data.get('amount')
    try:
        if isinstance(raw_amount, bool):
            raise ValueError
        amount = round(float(raw_amount), 2)
    except (TypeError, ValueError):
        return None, 'Amount must be a number'
    if not math.isfinite(amount) or amount <= 0 or amount > MAX_AMOUNT:
        return None, f'Amount must be more than ₱0 and at most ₱{MAX_AMOUNT:,.2f}'

    notes = data.get('notes')
    if notes is None:
        notes = ''
    if not isinstance(notes, str):
        return None, 'Notes must be text'
    notes = notes.strip()
    if len(notes) > MAX_NOTES:
        return None, f'Notes must be at most {MAX_NOTES} characters'

    return (bought.isoformat(), amount, notes or None), None


def _announce():
    """Tell open dashboards to refetch. Best effort: a missed event only leaves
    a band stale until the dashboard's next poll."""
    try:
        get_socketio().emit('feed_purchases')
    except Exception:
        pass


@feed_bp.route('/status', methods=['GET'])
@require_auth
@require_admin
def get_status():
    conn = get_db()
    try:
        return jsonify(_status(conn.cursor()))
    finally:
        conn.close()


@feed_bp.route('/purchases', methods=['GET'])
@require_auth
@require_admin
def list_purchases():
    # ponytail: every row, paged in the browser. About 26 a year; page in SQL
    # if the history ever reaches thousands.
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute(f'SELECT {_COLUMNS} FROM feed_purchases WHERE deleted = 0 '
                  'ORDER BY purchased_on DESC, id DESC')
        purchases = [_serialize(row) for row in c.fetchall()]
    finally:
        conn.close()
    return jsonify({
        'purchases': purchases,
        'status': feed_status(purchases[0] if purchases else None, date.today()),
    })


@feed_bp.route('/purchases', methods=['POST'])
@require_auth
@require_admin
def create_purchase():
    values, error = _parse(request.get_json(silent=True))
    if error:
        return jsonify({'error': error}), 400
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute('INSERT INTO feed_purchases (purchased_on, amount, notes) VALUES (?, ?, ?)', values)
        new_id = c.lastrowid
        _log_audit(conn, request.user['sub'], 'CREATE_FEED_PURCHASE', 'feed_purchases', str(new_id),
                   f'{values[0]} ₱{values[1]:,.2f}')
        conn.commit()
        body = {'purchase': _find(c, new_id), 'status': _status(c)}
    finally:
        conn.close()
    _announce()
    return jsonify(body), 201


@feed_bp.route('/purchases/<int:purchase_id>', methods=['PUT'])
@require_auth
@require_admin
def update_purchase(purchase_id):
    values, error = _parse(request.get_json(silent=True))
    if error:
        return jsonify({'error': error}), 400
    conn = get_db()
    try:
        c = conn.cursor()
        # Looked up rather than read off rowcount: MariaDB reports 0 affected
        # rows for a save that changed nothing, which would 404 a valid edit.
        if not _find(c, purchase_id):
            return jsonify({'error': 'Purchase not found'}), 404
        c.execute('UPDATE feed_purchases SET purchased_on = ?, amount = ?, notes = ? WHERE id = ?',
                  (*values, purchase_id))
        _log_audit(conn, request.user['sub'], 'UPDATE_FEED_PURCHASE', 'feed_purchases', str(purchase_id),
                   f'{values[0]} ₱{values[1]:,.2f}')
        conn.commit()
        body = {'purchase': _find(c, purchase_id), 'status': _status(c)}
    finally:
        conn.close()
    _announce()
    return jsonify(body)


@feed_bp.route('/purchases/<int:purchase_id>', methods=['DELETE'])
@require_auth
@require_admin
def delete_purchase(purchase_id):
    conn = get_db()
    try:
        c = conn.cursor()
        purchase = _find(c, purchase_id)
        if not purchase:
            return jsonify({'error': 'Purchase not found'}), 404
        c.execute('UPDATE feed_purchases SET deleted = 1 WHERE id = ?', (purchase_id,))
        _log_audit(conn, request.user['sub'], 'DELETE_FEED_PURCHASE', 'feed_purchases', str(purchase_id),
                   f"{purchase['purchased_on']} ₱{purchase['amount']:,.2f}")
        conn.commit()
        body = {'status': _status(c)}
    finally:
        conn.close()
    _announce()
    return jsonify(body)

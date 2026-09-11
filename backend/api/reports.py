"""
Reports API — the rows behind the Reports tab.

Routes:
  GET /api/reports/data?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD   — [Admin]

Returns the stock on hand before the range plus every inventory row and
counting session inside it. The browser builds all four reports from this one
payload (frontend/src/utils/reports.js), so the tab costs one round trip and a
report's table, chart and exports are all views of the same rows.
"""
import re
from datetime import date, datetime, timedelta

from flask import Blueprint, jsonify, request

from backend.api.auth_otp import require_auth
from backend.api.inventory import PRICE_PER_FISH, _row_scalar, _serialize_inventory_row
from backend.api.settings import require_admin
from backend.core.db import get_db

reports_bp = Blueprint('reports', __name__)

_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

# The live stock pool — the same rows /get_wholesale_stock sums. Archived rows
# still count; deleted ones never do.
_STOCK_ROWS = "deleted = 0 AND (action='WHOLESALE' OR action='INVENTORY')"


def _parse_range(args):
    """(start, end) dates, the last 30 days when neither is given, or None."""
    start = args.get('start_date', '').strip()
    end = args.get('end_date', '').strip()
    if not start and not end:
        today = datetime.now().date()
        return today - timedelta(days=29), today
    if not (_DATE_RE.match(start) and _DATE_RE.match(end)):
        return None
    try:
        d_start, d_end = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError:
        return None
    return (d_end, d_start) if d_start > d_end else (d_start, d_end)


def _stamp(value):
    return value.strftime('%Y-%m-%d %H:%M:%S') if hasattr(value, 'strftime') else value


@reports_bp.route('/api/reports/data')
@require_auth
@require_admin
def report_data():
    span = _parse_range(request.args)
    if span is None:
        return jsonify({'error': 'start_date and end_date must both be valid YYYY-MM-DD dates'}), 400
    start, end = (d.isoformat() for d in span)

    # ponytail: raw rows, grouped in the browser. A year of this farm is a few
    # hundred rows; move the grouping into SQL if a range reaches tens of thousands.
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute(
            f"SELECT COALESCE(SUM(count), 0) AS stock FROM inventory WHERE {_STOCK_ROWS} AND DATE(date) < ?",
            (start,))
        opening = int(_row_scalar(c.fetchone(), 'stock') or 0)

        c.execute(
            f"SELECT * FROM inventory WHERE {_STOCK_ROWS} AND DATE(date) BETWEEN ? AND ? ORDER BY date, id",
            (start, end))
        records = [_serialize_inventory_row(row) for row in c.fetchall()]

        c.execute(
            "SELECT id, username, started_at, ended_at, final_count, status FROM counting_sessions "
            "WHERE DATE(started_at) BETWEEN ? AND ? ORDER BY started_at, id",
            (start, end))
        sessions = [{
            'id': row['id'],
            'username': row['username'],
            'started_at': _stamp(row['started_at']),
            'ended_at': _stamp(row['ended_at']),
            'final_count': row['final_count'],
            'status': row['status'],
        } for row in c.fetchall()]
    finally:
        conn.close()

    return jsonify({
        'start_date': start,
        'end_date': end,
        'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'price_per_fish': PRICE_PER_FISH,
        'opening_stock': opening,
        'records': records,
        'sessions': sessions,
    })

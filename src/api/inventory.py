from flask import Blueprint, request, jsonify, render_template
from src.core.db import get_db, DB_ENGINE
from datetime import datetime, timedelta
import re
import os
from src.core.runtime import get_runtime

inventory_bp = Blueprint('inventory', __name__)

WHOLESALE_LINK_MARKER_PATTERN = re.compile(r"\[AUTO_LINK:WHOLESALE_PARENT_ID=(\d+)\]")

RETAIL_PRICE_PER_FISH = float(os.environ.get('RETAIL_PRICE_PER_FISH', '5'))
WHOLESALE_PRICE_PER_FISH = float(os.environ.get('WHOLESALE_PRICE_PER_FISH', '1.75'))


def _date_expr(fmt: str) -> str:
    """Return an engine-specific SQL expression for formatting `date`.

    fmt must be one of '%Y-%m', '%Y', '%m'. Returned expression uses a
    parameter placeholder '?' so callers can keep using parameterized queries.
    """
    if DB_ENGINE in ('mysql', 'mariadb'):
        if fmt == '%Y-%m':
            return "CONCAT(YEAR(date), '-', LPAD(MONTH(date), 2, '0'))"
        if fmt == '%Y':
            return "CAST(YEAR(date) AS CHAR)"
        if fmt == '%m':
            return "LPAD(MONTH(date), 2, '0')"
    else:
        if fmt == '%Y-%m':
            return "strftime('%Y-%m', date)"
        if fmt == '%Y':
            return "strftime('%Y', date)"
        if fmt == '%m':
            return "strftime('%m', date)"
    # Fallback to raw column
    return 'date'


def _period_expr(period: str) -> str:
    """Return an engine-specific SQL expression for grouping by period.

    Supported period values: 'day', 'week', 'month', 'year'.
    """
    p = (period or '').strip().lower()
    if DB_ENGINE in ('mysql', 'mariadb'):
        if p == 'day':
            return 'DATE(date)'
        if p == 'week':
            return "CONCAT(YEAR(date), '-', LPAD(WEEK(date, 1), 2, '0'))"
        if p == 'month':
            return _date_expr('%Y-%m')
        if p == 'year':
            return _date_expr('%Y')
    else:
        if p == 'day':
            return "strftime('%Y-%m-%d', date)"
        if p == 'week':
            return "strftime('%Y-%W', date)"
        if p == 'month':
            return _date_expr('%Y-%m')
        if p == 'year':
            return _date_expr('%Y')
    return 'date'


def _row_scalar(row, key: str):
    if row is None:
        return 0
    if isinstance(row, dict):
        if key in row:
            return row[key] or 0
        values = list(row.values())
        return values[0] if values else 0
    return row[0] if row else 0


def _row_value(row, key: str, index: int = 0, default=0):
    if row is None:
        return default
    if isinstance(row, dict):
        return row.get(key, default)
    return row[index] if len(row) > index else default


def _make_wholesale_link_marker(parent_id: int) -> str:
    return f"[AUTO_LINK:WHOLESALE_PARENT_ID={int(parent_id)}]"


def _append_wholesale_link_marker(notes, parent_id: int) -> str:
    base = (notes or '').strip()
    marker = _make_wholesale_link_marker(parent_id)
    if marker in base:
        return base
    if base:
        return f"{base} {marker}"
    return marker


def _extract_wholesale_parent_link(notes) -> int:
    note_text = notes or ''
    match = WHOLESALE_LINK_MARKER_PATTERN.search(note_text)
    if not match:
        return 0
    try:
        return int(match.group(1))
    except Exception:
        return 0


def _strip_wholesale_link_marker(notes) -> str:
    note_text = notes or ''
    cleaned = WHOLESALE_LINK_MARKER_PATTERN.sub('', note_text)
    return re.sub(r'\s{2,}', ' ', cleaned).strip()


@inventory_bp.route('/save_inventory', methods=['POST'])
def save_inventory():
    runtime = get_runtime()
    data = request.get_json()
    count = data.get("count", runtime.fish_count)
    variant = data.get("variant", "Unknown")
    notes = data.get("notes", "")
    action = str(data.get("action", "IN")).strip().upper()
    if action == 'INVENTORY':
        action = 'WHOLESALE'
    if action not in {'IN', 'OUT', 'WHOLESALE'}:
        action = 'IN'

    # Validate count
    try:
        if int(count) <= 0:
            return jsonify({"status": "error", "message": "Count must be greater than zero"}), 400
    except Exception:
        return jsonify({"status": "error", "message": "Invalid count"}), 400
    
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        INSERT INTO inventory (count, variant, date, notes, action)
        VALUES (?, ?, ?, ?, ?)
    ''', (count, variant, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), notes, action))
    conn.commit()
    conn.close()
    
    return jsonify({"status": "success", "message": f"Saved {count} {variant} fish to inventory!"})


@inventory_bp.route('/get_inventory')
def get_inventory():
    variant = request.args.get("variant", "").strip()
    start_date = request.args.get("start_date", "").strip()
    end_date = request.args.get("end_date", "").strip()
    month = request.args.get("month", "").strip()
    month_to = request.args.get("month_to", "").strip()
    year = request.args.get("year", "").strip()
    year_to = request.args.get("year_to", "").strip()
    search = request.args.get("search", "").strip()
    
    where_clause = "WHERE deleted = 0"
    params = []
    
    conditions = []

    if search:
        conditions.append("LOWER(notes) LIKE ?")
        params.append(f"%{search.lower()}%")

    if variant:
        variants = [v.strip() for v in variant.split(',') if v.strip()]
        if len(variants) == 1:
            conditions.append("variant = ?")
            params.append(variants[0])
        elif variants:
            placeholders = ','.join('?' * len(variants))
            conditions.append(f"variant IN ({placeholders})")
            params.extend(variants)

    _date_re_local = re.compile(r'^\d{4}-\d{2}-\d{2}$')

    # Prefer new start_date / end_date range over legacy month/year params
    if start_date or end_date:
        if start_date and _date_re_local.match(start_date) and end_date and _date_re_local.match(end_date):
            if start_date > end_date:
                start_date, end_date = end_date, start_date
            conditions.append("DATE(date) BETWEEN ? AND ?")
            params.extend([start_date, end_date])
        elif start_date and _date_re_local.match(start_date):
            conditions.append("DATE(date) >= ?")
            params.append(start_date)
        elif end_date and _date_re_local.match(end_date):
            conditions.append("DATE(date) <= ?")
            params.append(end_date)
    else:
        def _normalize_month(value: str, default: str) -> str:
            if not value:
                return default
            try:
                numeric = int(value)
                if numeric < 1:
                    numeric = 1
                if numeric > 12:
                    numeric = 12
                return f"{numeric:02d}"
            except Exception:
                return default

        if year or year_to:
            start_year = year or year_to
            end_year = year_to or year
            if start_year > end_year:
                start_year, end_year = end_year, start_year

            start_ym = f"{start_year}-{_normalize_month(month, '01')}"
            end_ym = f"{end_year}-{_normalize_month(month_to, '12')}"
            if start_ym > end_ym:
                start_ym, end_ym = end_ym, start_ym

            conditions.append(f"{_date_expr('%Y-%m')} BETWEEN ? AND ?")
            params.extend([start_ym, end_ym])
        elif month or month_to:
            start_month = _normalize_month(month, '01')
            end_month = _normalize_month(month_to, '12')
            if start_month > end_month:
                start_month, end_month = end_month, start_month
            conditions.append(f"{_date_expr('%m')} BETWEEN ? AND ?")
            params.extend([start_month, end_month])
    
    if conditions:
        where_clause += " AND " + " AND ".join(conditions)
    
    # Pagination support (optional — if page param present, return paginated)
    page_param = request.args.get("page", "").strip()
    per_page_param = request.args.get("per_page", "20").strip()

    conn = get_db()
    c = conn.cursor()

    if page_param:
        try:
            page = max(1, int(page_param))
            per_page = max(1, min(100, int(per_page_param)))
        except Exception:
            page, per_page = 1, 20

        count_query = f'SELECT COUNT(*) as total FROM inventory {where_clause}'
        c.execute(count_query, params)
        total = int(_row_scalar(c.fetchone(), 'total') or 0)
        total_pages = max(1, (total + per_page - 1) // per_page)
        offset = (page - 1) * per_page

        query = f'SELECT * FROM inventory {where_clause} ORDER BY id DESC LIMIT ? OFFSET ?'
        c.execute(query, params + [per_page, offset])
        records = c.fetchall()
        conn.close()

        items = []
        for record in records:
            items.append({
                "id": record["id"],
                "count": record["count"],
                "variant": record["variant"],
                "date": record["date"],
                "notes": record["notes"],
                "action": record["action"] if "action" in record.keys() else "IN"
            })
        return jsonify({"items": items, "total": total, "page": page, "per_page": per_page, "pages": total_pages})

    # Default: return flat list (backward-compatible)
    query = f'SELECT * FROM inventory {where_clause} ORDER BY id DESC'
    c.execute(query, params)
    records = c.fetchall()
    conn.close()
    
    inventory_list = []
    for record in records:
        inventory_list.append({
            "id": record["id"],
            "count": record["count"],
            "variant": record["variant"],
            "date": record["date"],
            "notes": record["notes"],
            "action": record["action"] if "action" in record.keys() else "IN"
        })
    
    return jsonify(inventory_list)


@inventory_bp.route('/delete_inventory/<int:id>', methods=['DELETE'])
def delete_inventory(id):
    conn = get_db()
    c = conn.cursor()

    c.execute('SELECT id, count, variant, action, deleted FROM inventory WHERE id = ?', (id,))
    record = c.fetchone()
    if not record:
        conn.close()
        return jsonify({"status": "error", "message": "Record not found"}), 404

    if int(_row_value(record, 'deleted', 4, 0) or 0) == 1:
        conn.close()
        return jsonify({"status": "success", "message": "Record already archived"})

    target_action = (_row_value(record, 'action', 3, '') or '').upper()
    target_count = int(_row_value(record, 'count', 1, 0) or 0)
    target_variant = _row_value(record, 'variant', 2, '')

    c.execute('UPDATE inventory SET deleted = 1 WHERE id = ?', (id,))

    cascaded_ids = []
    if target_action == 'WHOLESALE' and target_count > 0 and target_variant:
        c.execute('''
            SELECT COALESCE(SUM(count), 0) AS wholesale_balance
            FROM inventory
            WHERE deleted = 0 AND variant = ? AND action = 'WHOLESALE'
        ''', (target_variant,))
        wholesale_balance = int(_row_scalar(c.fetchone(), 'wholesale_balance') or 0)

        if wholesale_balance < 0:
            deficit = abs(wholesale_balance)
            c.execute('''
                SELECT id, count
                FROM inventory
                WHERE deleted = 0 AND variant = ? AND action = 'WHOLESALE' AND count < 0
                ORDER BY date DESC, id DESC
            ''', (target_variant,))
            sold_rows = c.fetchall()

            for sold_row in sold_rows:
                sold_id = int(_row_value(sold_row, 'id', 0, 0) or 0)
                sold_count = abs(int(_row_value(sold_row, 'count', 1, 0) or 0))
                if sold_id <= 0 or sold_count <= 0:
                    continue
                c.execute('SELECT notes FROM inventory WHERE id = ?', (sold_id,))
                sold_detail = c.fetchone()
                linked_notes = _append_wholesale_link_marker(
                    _row_value(sold_detail, 'notes', 0, ''),
                    id
                )
                c.execute('UPDATE inventory SET deleted = 1, notes = ? WHERE id = ?', (linked_notes, sold_id))
                cascaded_ids.append(sold_id)
                deficit -= sold_count
                if deficit <= 0:
                    break

    conn.commit()
    conn.close()

    if cascaded_ids:
        return jsonify({
            "status": "success",
            "message": f"Record moved to archive. Also archived {len(cascaded_ids)} connected wholesale sold record(s) to prevent negative stock.",
            "cascaded_ids": cascaded_ids
        })

    return jsonify({"status": "success", "message": "Record moved to archive"})


@inventory_bp.route('/clear_inventory', methods=['POST'])
def clear_inventory():
    conn = get_db()
    c = conn.cursor()
    c.execute('UPDATE inventory SET deleted = 1 WHERE deleted = 0')
    archived_count = c.rowcount
    conn.commit()
    conn.close()
    
    return jsonify({"status": "success", "message": f"{archived_count} record(s) moved to archive"})


@inventory_bp.route('/get_statistics')
def get_statistics():
    variant = request.args.get("variant", "").strip()
    start_date = request.args.get("start_date", "").strip()
    end_date = request.args.get("end_date", "").strip()
    # Legacy params kept for backward compatibility
    month = request.args.get("month", "").strip()
    month_to = request.args.get("month_to", "").strip()
    year = request.args.get("year", "").strip()
    year_to = request.args.get("year_to", "").strip()
    
    where_clause = "WHERE deleted = 0"
    params = []
    conditions = []
    
    if variant:
        conditions.append("variant = ?")
        params.append(variant)

    # Prefer new start_date / end_date range over legacy month/year params
    if start_date or end_date:
        _date_re = re.compile(r'^\d{4}-\d{2}-\d{2}$')
        if start_date and _date_re.match(start_date) and end_date and _date_re.match(end_date):
            if start_date > end_date:
                start_date, end_date = end_date, start_date
            conditions.append("DATE(date) BETWEEN ? AND ?")
            params.extend([start_date, end_date])
        elif start_date and _date_re.match(start_date):
            conditions.append("DATE(date) >= ?")
            params.append(start_date)
        elif end_date and _date_re.match(end_date):
            conditions.append("DATE(date) <= ?")
            params.append(end_date)
    else:
        # Legacy filter support
        def _normalize_month(value: str, default: str) -> str:
            if not value:
                return default
            try:
                numeric = int(value)
                if numeric < 1:
                    numeric = 1
                if numeric > 12:
                    numeric = 12
                return f"{numeric:02d}"
            except Exception:
                return default

        if year or year_to:
            start_year = year or year_to
            end_year = year_to or year
            if start_year > end_year:
                start_year, end_year = end_year, start_year

            start_ym = f"{start_year}-{_normalize_month(month, '01')}"
            end_ym = f"{end_year}-{_normalize_month(month_to, '12')}"
            if start_ym > end_ym:
                start_ym, end_ym = end_ym, start_ym

            conditions.append(f"{_date_expr('%Y-%m')} BETWEEN ? AND ?")
            params.extend([start_ym, end_ym])
        elif month or month_to:
            start_month = _normalize_month(month, '01')
            end_month = _normalize_month(month_to, '12')
            if start_month > end_month:
                start_month, end_month = end_month, start_month
            conditions.append(f"{_date_expr('%m')} BETWEEN ? AND ?")
            params.extend([start_month, end_month])
    
    if conditions:
        where_clause += " AND " + " AND ".join(conditions)
    
    conn = get_db()
    c = conn.cursor()
    
    query = f"SELECT SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END) as tank_total FROM inventory {where_clause} AND (action='IN' OR action='OUT')"
    c.execute(query, params)
    tank_total = _row_scalar(c.fetchone(), 'tank_total') or 0

    query = f"SELECT variant, SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END) as total FROM inventory {where_clause} AND (action='IN' OR action='OUT') GROUP BY variant ORDER BY total DESC"
    c.execute(query, params)
    by_variant = []
    for row in c.fetchall():
        by_variant.append({
            "variant": _row_value(row, 'variant', 0),
            "count": _row_value(row, 'total', 1, 0),
        })

    if where_clause:
        where_clause_add = where_clause + " AND (action='IN' OR action='INVENTORY' OR (action='WHOLESALE' AND count > 0))"
    else:
        where_clause_add = "WHERE (action='IN' OR action='INVENTORY' OR (action='WHOLESALE' AND count > 0))"

    query = "SELECT SUM(count) as additions_total FROM inventory " + where_clause_add
    c.execute(query, params)
    additions_total = _row_scalar(c.fetchone(), 'additions_total') or 0

    query = f"SELECT SUM(count) as wholesale_total FROM inventory {where_clause} AND (action='WHOLESALE' OR action='INVENTORY')"
    c.execute(query, params)
    wholesale_total = _row_scalar(c.fetchone(), 'wholesale_total') or 0

    query = f"SELECT variant, SUM(count) as total FROM inventory {where_clause} AND (action='WHOLESALE' OR action='INVENTORY') GROUP BY variant ORDER BY total DESC"
    c.execute(query, params)
    by_variant_wholesale = []
    for row in c.fetchall():
        by_variant_wholesale.append({
            "variant": _row_value(row, 'variant', 0),
            "count": _row_value(row, 'total', 1, 0),
        })

    query = "SELECT variant, SUM(count) as total FROM inventory " + where_clause_add + " GROUP BY variant ORDER BY total DESC"
    c.execute(query, params)
    by_variant_additions = []
    for row in c.fetchall():
        by_variant_additions.append({
            "variant": _row_value(row, 'variant', 0),
            "count": _row_value(row, 'total', 1, 0),
        })

    query = "SELECT * FROM inventory " + where_clause + " ORDER BY date DESC, id DESC LIMIT 5"
    c.execute(query, params)
    recent_additions = []
    for row in c.fetchall():
        action_value = row["action"] if "action" in row.keys() else "IN"
        source_value = "Storage Box" if action_value == 'WHOLESALE' else "Fish Tank"
        recent_additions.append({
            "id": row["id"],
            "count": row["count"],
            "variant": row["variant"],
            "date": row["date"],
            "notes": row["notes"],
            "action": action_value,
            "source": source_value
        })
    
    query = f'SELECT COUNT(*) as count FROM inventory {where_clause}'
    c.execute(query, params)
    total_entries = _row_scalar(c.fetchone(), 'count')

    today_revenue_query = (
        "SELECT "
        "SUM(CASE WHEN action='OUT' AND notes NOT LIKE 'Died.%' THEN ABS(count) ELSE 0 END) as retail_sold, "
        "SUM(CASE WHEN action='WHOLESALE' AND count < 0 AND notes NOT LIKE 'Died.%' THEN ABS(count) ELSE 0 END) as wholesale_sold "
        "FROM inventory WHERE deleted = 0 AND DATE(date) = CURRENT_DATE"
    )
    c.execute(today_revenue_query)
    today_sales = c.fetchone()
    retail_sold_today = float(_row_scalar(today_sales, 'retail_sold') or 0)
    wholesale_sold_today = float(_row_scalar(today_sales, 'wholesale_sold') or 0)
    today_revenue = round((retail_sold_today * RETAIL_PRICE_PER_FISH) + (wholesale_sold_today * WHOLESALE_PRICE_PER_FISH), 2)
    
    # Compute total revenue for the selected filters (uses the same where_clause/params)
    try:
        total_sales_query = (
            "SELECT "
            "SUM(CASE WHEN action='OUT' AND notes NOT LIKE 'Died.%' THEN ABS(count) ELSE 0 END) as retail_sold_total, "
            "SUM(CASE WHEN action='WHOLESALE' AND count < 0 AND notes NOT LIKE 'Died.%' THEN ABS(count) ELSE 0 END) as wholesale_sold_total "
            f"FROM inventory {where_clause}"
        )
        c.execute(total_sales_query, params)
        total_sales = c.fetchone()
        retail_sold_total = float(_row_scalar(total_sales, 'retail_sold_total') or 0)
        wholesale_sold_total = float(_row_scalar(total_sales, 'wholesale_sold_total') or 0)
        total_revenue = round((retail_sold_total * RETAIL_PRICE_PER_FISH) + (wholesale_sold_total * WHOLESALE_PRICE_PER_FISH), 2)
    except Exception:
        total_revenue = 0.0

    # --- Yesterday metrics for trend comparison ---
    yesterday_str = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    today_str = datetime.now().strftime('%Y-%m-%d')
    try:
        # Yesterday's additions_total (Total Fish as of end of yesterday)
        yday_add_clause = "WHERE deleted = 0 AND DATE(date) <= ? AND (action='IN' OR action='INVENTORY' OR (action='WHOLESALE' AND count > 0))"
        c.execute("SELECT SUM(count) as total FROM inventory " + yday_add_clause, [yesterday_str])
        yesterday_additions_total = _row_scalar(c.fetchone(), 'total') or 0

        # Yesterday's tank_total (Fish in Tank as of end of yesterday)
        yday_tank_clause = "WHERE deleted = 0 AND DATE(date) <= ? AND (action='IN' OR action='OUT')"
        c.execute("SELECT SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END) as total FROM inventory " + yday_tank_clause, [yesterday_str])
        yesterday_tank_total = _row_scalar(c.fetchone(), 'total') or 0

        # Yesterday's wholesale_total (Wholesale Storage as of end of yesterday)
        yday_ws_clause = "WHERE deleted = 0 AND DATE(date) <= ? AND (action='WHOLESALE' OR action='INVENTORY')"
        c.execute("SELECT SUM(count) as total FROM inventory " + yday_ws_clause, [yesterday_str])
        yesterday_wholesale_total = _row_scalar(c.fetchone(), 'total') or 0

        # Yesterday's daily revenue
        yday_rev_query = (
            "SELECT "
            "SUM(CASE WHEN action='OUT' AND notes NOT LIKE 'Died.%' THEN ABS(count) ELSE 0 END) as retail_sold, "
            "SUM(CASE WHEN action='WHOLESALE' AND count < 0 AND notes NOT LIKE 'Died.%' THEN ABS(count) ELSE 0 END) as wholesale_sold "
            "FROM inventory WHERE deleted = 0 AND DATE(date) = ?"
        )
        c.execute(yday_rev_query, [yesterday_str])
        yday_sales = c.fetchone()
        yday_retail = float(_row_scalar(yday_sales, 'retail_sold') or 0)
        yday_wholesale = float(_row_scalar(yday_sales, 'wholesale_sold') or 0)
        yesterday_revenue = round((yday_retail * RETAIL_PRICE_PER_FISH) + (yday_wholesale * WHOLESALE_PRICE_PER_FISH), 2)

        # Yesterday's cumulative total revenue (all time up to end of yesterday)
        yday_total_rev_query = (
            "SELECT "
            "SUM(CASE WHEN action='OUT' AND notes NOT LIKE 'Died.%' THEN ABS(count) ELSE 0 END) as retail_sold_total, "
            "SUM(CASE WHEN action='WHOLESALE' AND count < 0 AND notes NOT LIKE 'Died.%' THEN ABS(count) ELSE 0 END) as wholesale_sold_total "
            "FROM inventory WHERE deleted = 0 AND DATE(date) <= ?"
        )
        c.execute(yday_total_rev_query, [yesterday_str])
        yday_total_sales = c.fetchone()
        yday_retail_total = float(_row_scalar(yday_total_sales, 'retail_sold_total') or 0)
        yday_wholesale_total_rev = float(_row_scalar(yday_total_sales, 'wholesale_sold_total') or 0)
        yesterday_total_revenue = round((yday_retail_total * RETAIL_PRICE_PER_FISH) + (yday_wholesale_total_rev * WHOLESALE_PRICE_PER_FISH), 2)
    except Exception:
        yesterday_additions_total = 0
        yesterday_tank_total = 0
        yesterday_wholesale_total = 0
        yesterday_revenue = 0.0
        yesterday_total_revenue = 0.0

    # --- Global (unfiltered) current values for trend comparison ---
    try:
        c.execute("SELECT SUM(count) as total FROM inventory WHERE deleted = 0 AND (action='IN' OR action='INVENTORY' OR (action='WHOLESALE' AND count > 0))")
        global_additions_total = _row_scalar(c.fetchone(), 'total') or 0

        c.execute("SELECT SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END) as total FROM inventory WHERE deleted = 0 AND (action='IN' OR action='OUT')")
        global_tank_total = _row_scalar(c.fetchone(), 'total') or 0

        c.execute("SELECT SUM(count) as total FROM inventory WHERE deleted = 0 AND (action='WHOLESALE' OR action='INVENTORY')")
        global_wholesale_total = _row_scalar(c.fetchone(), 'total') or 0

        global_total_rev_query = (
            "SELECT "
            "SUM(CASE WHEN action='OUT' AND notes NOT LIKE 'Died.%' THEN ABS(count) ELSE 0 END) as retail_sold_total, "
            "SUM(CASE WHEN action='WHOLESALE' AND count < 0 AND notes NOT LIKE 'Died.%' THEN ABS(count) ELSE 0 END) as wholesale_sold_total "
            "FROM inventory WHERE deleted = 0"
        )
        c.execute(global_total_rev_query)
        global_rev_row = c.fetchone()
        global_retail_total = float(_row_scalar(global_rev_row, 'retail_sold_total') or 0)
        global_wholesale_total_rev = float(_row_scalar(global_rev_row, 'wholesale_sold_total') or 0)
        global_total_revenue = round((global_retail_total * RETAIL_PRICE_PER_FISH) + (global_wholesale_total_rev * WHOLESALE_PRICE_PER_FISH), 2)
    except Exception:
        global_additions_total = additions_total
        global_tank_total = tank_total
        global_wholesale_total = wholesale_total
        global_total_revenue = total_revenue

    conn.close()
    
    return jsonify({
        "tank_total": tank_total,
        "by_variant": by_variant,
        "additions_total": additions_total,
        "wholesale_total": wholesale_total,
        "by_variant_wholesale": by_variant_wholesale,
        "by_variant_additions": by_variant_additions,
        "recent_additions": recent_additions,
        "total_entries": total_entries,
        "today_revenue": today_revenue,
        "total_revenue": total_revenue,
        "yesterday": {
            "additions_total": yesterday_additions_total,
            "tank_total": yesterday_tank_total,
            "wholesale_total": yesterday_wholesale_total,
            "today_revenue": yesterday_revenue,
            "total_revenue": yesterday_total_revenue
        },
        "global": {
            "additions_total": global_additions_total,
            "tank_total": global_tank_total,
            "wholesale_total": global_wholesale_total,
            "today_revenue": today_revenue,
            "total_revenue": global_total_revenue
        }
    })


@inventory_bp.route('/get_monthly_tank')
def get_monthly_tank():
    """Return cumulative 'fish in tank' totals at each month-end (YYYY-MM).

    This computes the running net (IN - OUT) up to and including each month.
    Optional query param `year` may be provided to limit results to a single year.
    """
    year = request.args.get('year', '').strip()

    conn = get_db()
    c = conn.cursor()

    # Get all distinct year-month values present (optionally restricted to year)
    if year:
        months_query = f"SELECT DISTINCT {_date_expr('%Y-%m')} as ym FROM inventory WHERE deleted = 0 AND {_date_expr('%Y')} = ? ORDER BY ym"
        c.execute(months_query, (year,))
    else:
        months_query = f"SELECT DISTINCT {_date_expr('%Y-%m')} as ym FROM inventory WHERE deleted = 0 ORDER BY ym"
        c.execute(months_query)

    months = [_row_value(r, 'ym', 0, '') for r in c.fetchall()]

    result = []
    # For each month, compute cumulative net up to and including that month
    for ym in months:
        if year:
            sum_query = f"SELECT SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END) as net FROM inventory WHERE deleted = 0 AND (action='IN' OR action='OUT') AND {_date_expr('%Y-%m')} <= ? AND {_date_expr('%Y')} = ?"
            c.execute(sum_query, (ym, year))
        else:
            sum_query = f"SELECT SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END) as net FROM inventory WHERE deleted = 0 AND (action='IN' OR action='OUT') AND {_date_expr('%Y-%m')} <= ?"
            c.execute(sum_query, (ym,))

        net = _row_scalar(c.fetchone(), 'net') or 0
        result.append({"month": ym, "total": net})

    conn.close()
    return jsonify(result)


@inventory_bp.route('/get_monthly_tank_by_variant')
def get_monthly_tank_by_variant():
    """Return cumulative 'fish in tank' totals per variant at each month-end (YYYY-MM).

    Optional query param `year` may be provided to limit results to a single year.
    Response format: [{"month":"YYYY-MM","Black":n,"Platinum":m,"Pineapple":p}, ...]
    """
    year = request.args.get('year', '').strip()

    conn = get_db()
    c = conn.cursor()

    # Get distinct months
    if year:
        months_q = f"SELECT DISTINCT {_date_expr('%Y-%m')} as ym FROM inventory WHERE deleted = 0 AND {_date_expr('%Y')} = ? ORDER BY ym"
        c.execute(months_q, (year,))
    else:
        months_q = f"SELECT DISTINCT {_date_expr('%Y-%m')} as ym FROM inventory WHERE deleted = 0 ORDER BY ym"
        c.execute(months_q)

    months = [_row_value(r, 'ym', 0, '') for r in c.fetchall()]

    variants = ['Black', 'Platinum', 'Pineapple']
    result = []

    for ym in months:
        row = {'month': ym}
        for v in variants:
            if year:
                sum_q = f"SELECT SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END) as net FROM inventory WHERE deleted = 0 AND variant = ? AND (action='IN' OR action='OUT') AND {_date_expr('%Y-%m')} <= ? AND {_date_expr('%Y')} = ?"
                c.execute(sum_q, (v, ym, year))
            else:
                sum_q = f"SELECT SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END) as net FROM inventory WHERE deleted = 0 AND variant = ? AND (action='IN' OR action='OUT') AND {_date_expr('%Y-%m')} <= ?"
                c.execute(sum_q, (v, ym))
            net = _row_scalar(c.fetchone(), 'net') or 0
            row[v] = net
        result.append(row)

    conn.close()
    return jsonify(result)


@inventory_bp.route('/get_time_series')
def get_time_series():
    """Return aggregated sales totals per period for tank and wholesale.

    Query params:
      - period: 'day', 'week', 'month' (default), or 'year'
      - source: 'tank', 'wholesale', or 'both' (default)
      - variant: optional variant name to filter
    Response JSON: { periods: ["YYYY-MM",...], tank: [n,...], wholesale: [m,...] }
    """
    period = request.args.get('period', 'month').strip().lower()
    source = request.args.get('source', 'both').strip().lower()
    variant = request.args.get('variant', '').strip()

    where = 'WHERE deleted = 0'
    params = []
    if variant:
        where += ' AND variant = ?'
        params.append(variant)

    period_expr = _period_expr(period)

    conn = get_db()
    c = conn.cursor()

    tank_map = {}
    wholesale_map = {}

    if source in ('tank', 'both'):
        q = f"SELECT {period_expr} as period, SUM(count) as total FROM inventory {where} AND action='OUT' GROUP BY period ORDER BY period"
        c.execute(q, params)
        for row in c.fetchall():
            key = _row_value(row, 'period', 0, '')
            tank_map[key] = int(_row_value(row, 'total', 1, 0) or 0)

    if source in ('wholesale', 'both'):
        # wholesale sold entries are stored as negative counts; aggregate absolute value
        q = f"SELECT {period_expr} as period, SUM(ABS(count)) as total FROM inventory {where} AND action='WHOLESALE' AND count < 0 GROUP BY period ORDER BY period"
        c.execute(q, params)
        for row in c.fetchall():
            key = _row_value(row, 'period', 0, '')
            wholesale_map[key] = int(_row_value(row, 'total', 1, 0) or 0)

    conn.close()

    periods = sorted(list(set(list(tank_map.keys()) + list(wholesale_map.keys()))))
    # normalize empty key behavior
    periods = [p for p in periods if p]

    tank_series = [tank_map.get(p, 0) for p in periods]
    wholesale_series = [wholesale_map.get(p, 0) for p in periods]

    return jsonify({
        'periods': periods,
        'tank': tank_series,
        'wholesale': wholesale_series
    })


@inventory_bp.route('/get_time_series_by_variant')
def get_time_series_by_variant():
    """Return aggregated sold totals per period and per variant.

    Query params:
      - period: 'day','week','month' (default 'month')
      - variant: optional (if provided, returns only that variant)

        Response: {
            periods: [...],
            variants: ["Black","Platinum",...],
            prices: { retail: 5, wholesale: 1.75 },
            data: {
                "Black": {
                    "tank": [...],
                    "wholesale": [...],
                    "tank_amount": [...],
                    "wholesale_amount": [...]
                },
                ...
            }
        }
    """
    period = request.args.get('period', 'month').strip().lower()
    variant_filter = request.args.get('variant', '').strip()

    period_expr = _period_expr(period)

    where = 'WHERE deleted = 0'
    params = []
    if variant_filter:
        where += ' AND variant = ?'
        params.append(variant_filter)

    conn = get_db()
    c = conn.cursor()

    # Query grouped by period and variant
    q = f"SELECT {period_expr} as period, variant, " \
        "SUM(CASE WHEN action='OUT' THEN ABS(count) ELSE 0 END) as tank_sold, " \
        "SUM(CASE WHEN action='WHOLESALE' AND count<0 THEN ABS(count) ELSE 0 END) as wholesale_sold " \
        f"FROM inventory {where} GROUP BY period, variant ORDER BY period"
    c.execute(q, params)
    rows = c.fetchall()
    conn.close()

    periods = []
    variants_set = set()
    values = {}

    for r in rows:
        p = _row_value(r, 'period', 0, '')
        v = _row_value(r, 'variant', 1, '')
        tank_sold = int(_row_value(r, 'tank_sold', 2, 0) or 0)
        wholesale_sold = int(_row_value(r, 'wholesale_sold', 3, 0) or 0)
        if not p:
            continue
        if p not in periods:
            periods.append(p)
        variants_set.add(v)
        if v not in values:
            values[v] = {'tank': {}, 'wholesale': {}}
        values[v]['tank'][p] = tank_sold
        values[v]['wholesale'][p] = wholesale_sold

    periods.sort()
    variants = sorted(list(variants_set))

    # build aligned arrays
    data = {}
    for v in variants:
        tank_series = [ values.get(v, {}).get('tank', {}).get(p, 0) for p in periods ]
        wholesale_series = [ values.get(v, {}).get('wholesale', {}).get(p, 0) for p in periods ]
        tank_amount_series = [ round((n or 0) * RETAIL_PRICE_PER_FISH, 2) for n in tank_series ]
        wholesale_amount_series = [ round((n or 0) * WHOLESALE_PRICE_PER_FISH, 2) for n in wholesale_series ]
        data[v] = {
            'tank': tank_series,
            'wholesale': wholesale_series,
            'tank_amount': tank_amount_series,
            'wholesale_amount': wholesale_amount_series
        }

    return jsonify({
        'periods': periods,
        'variants': variants,
        'prices': {
            'retail': RETAIL_PRICE_PER_FISH,
            'wholesale': WHOLESALE_PRICE_PER_FISH
        },
        'data': data
    })


@inventory_bp.route('/api/daily-trend')
def daily_trend():
    """Return daily sales, revenue, and running stock totals.

    Query params:
      - days: number of days to look back (default 30)
      - start_date, end_date: override explicit date range (YYYY-MM-DD)
      - variant: optional variant filter
    Response: { days: [...], prices: {retail, wholesale}, data: [{date, sold_tank, sold_wholesale, revenue, stock_tank, stock_wholesale}, ...] }
    """
    variant = request.args.get('variant', '').strip()
    days_param = request.args.get('days', '30').strip()
    start_date = request.args.get('start_date', '').strip()
    end_date = request.args.get('end_date', '').strip()

    _date_re = re.compile(r'^\d{4}-\d{2}-\d{2}$')
    today = datetime.now().date()

    if start_date and _date_re.match(start_date) and end_date and _date_re.match(end_date):
        from datetime import date as _date
        d_start = _date.fromisoformat(start_date)
        d_end = _date.fromisoformat(end_date)
        if d_start > d_end:
            d_start, d_end = d_end, d_start
        if d_end > today:
            d_end = today
    else:
        try:
            num_days = max(1, min(365, int(days_param)))
        except ValueError:
            num_days = 30
        d_end = today
        d_start = today - timedelta(days=num_days - 1)

    where_variant = ''
    params_variant = []
    if variant:
        where_variant = ' AND variant = ?'
        params_variant = [variant]

    conn = get_db()
    c = conn.cursor()

    # Pre-compute cumulative stock up to (but not including) d_start for running balance
    day_before = (d_start - timedelta(days=1)).isoformat()

    c.execute(
        "SELECT SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END) "
        "FROM inventory WHERE deleted = 0 AND (action='IN' OR action='OUT') AND DATE(date) <= ?"
        + where_variant,
        [day_before] + params_variant
    )
    running_tank = int(_row_scalar(c.fetchone(), 'total') or 0)

    c.execute(
        "SELECT SUM(count) "
        "FROM inventory WHERE deleted = 0 AND (action='WHOLESALE' OR action='INVENTORY') AND DATE(date) <= ?"
        + where_variant,
        [day_before] + params_variant
    )
    running_wholesale = int(_row_scalar(c.fetchone(), 'total') or 0)

    # Fetch daily aggregates for the date range
    range_where = "WHERE deleted = 0 AND DATE(date) BETWEEN ? AND ?" + where_variant
    range_params = [d_start.isoformat(), d_end.isoformat()] + params_variant

    c.execute(
        "SELECT DATE(date) as day, "
        "SUM(CASE WHEN action='IN' THEN count ELSE 0 END) as added_tank, "
        "SUM(CASE WHEN action='OUT' AND notes NOT LIKE 'Died.%%' THEN ABS(count) ELSE 0 END) as sold_tank, "
        "SUM(CASE WHEN action='WHOLESALE' AND count > 0 THEN count ELSE 0 END) as added_wholesale, "
        "SUM(CASE WHEN action='WHOLESALE' AND count < 0 AND notes NOT LIKE 'Died.%%' THEN ABS(count) ELSE 0 END) as sold_wholesale "
        "FROM inventory " + range_where + " GROUP BY day ORDER BY day",
        range_params
    )
    daily_raw = {}
    for row in c.fetchall():
        d = str(_row_value(row, 'day', 0, ''))
        daily_raw[d] = {
            'added_tank': int(_row_value(row, 'added_tank', 1, 0) or 0),
            'sold_tank': int(_row_value(row, 'sold_tank', 2, 0) or 0),
            'added_wholesale': int(_row_value(row, 'added_wholesale', 3, 0) or 0),
            'sold_wholesale': int(_row_value(row, 'sold_wholesale', 4, 0) or 0),
        }
    conn.close()

    # Build day-by-day series
    result = []
    current = d_start
    while current <= d_end:
        ds = current.isoformat()
        d = daily_raw.get(ds, {'added_tank': 0, 'sold_tank': 0, 'added_wholesale': 0, 'sold_wholesale': 0})
        running_tank += d['added_tank'] - d['sold_tank']
        running_wholesale += d['added_wholesale'] - d['sold_wholesale']
        revenue = round(d['sold_tank'] * RETAIL_PRICE_PER_FISH + d['sold_wholesale'] * WHOLESALE_PRICE_PER_FISH, 2)
        result.append({
            'date': ds,
            'sold_tank': d['sold_tank'],
            'sold_wholesale': d['sold_wholesale'],
            'sold_total': d['sold_tank'] + d['sold_wholesale'],
            'revenue': revenue,
            'stock_tank': max(0, running_tank),
            'stock_wholesale': max(0, running_wholesale),
        })
        current += timedelta(days=1)

    return jsonify({
        'start_date': d_start.isoformat(),
        'end_date': d_end.isoformat(),
        'prices': {'retail': RETAIL_PRICE_PER_FISH, 'wholesale': WHOLESALE_PRICE_PER_FISH},
        'data': result,
    })


@inventory_bp.route('/add_to_tank', methods=['POST'])
def add_to_tank():
    data = request.get_json()
    count = data.get("count", 0)
    variant = data.get("variant", "Unknown")
    notes = data.get("notes", "")

    conn = get_db()
    c = conn.cursor()
    try:
        if int(count) <= 0:
            return jsonify({"status": "error", "message": "Count must be greater than zero"}), 400
    except Exception:
        return jsonify({"status": "error", "message": "Invalid count"}), 400

    c.execute('''
        INSERT INTO inventory (count, variant, date, notes, action)
        VALUES (?, ?, ?, ?, 'IN')
    ''', (count, variant, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), notes))
    conn.commit()
    conn.close()

    return jsonify({"status": "success", "message": f"Added {count} {variant} to tank"})


@inventory_bp.route('/adjust_stock', methods=['POST'])
def adjust_stock():
    data = request.get_json()
    count = data.get("count", 0)
    variant = data.get("variant", "Unknown")
    reason = data.get("reason", "Sold")
    notes = data.get("notes", "")
    source = str(data.get("source", "")).strip().lower()
    wholesale_action = str(data.get("wholesale_action", "OUT")).strip().upper()
    direction = str(data.get("direction", "")).strip().lower()

    try:
        count = int(count)
    except Exception:
        return jsonify({"status": "error", "message": "Invalid count"}), 400

    if count <= 0:
        return jsonify({"status": "error", "message": "Count must be greater than zero"}), 400

    conn = get_db()
    c = conn.cursor()

    is_wholesale = source == 'wholesale' or (not source and str(reason).strip().lower() == 'wholesale')

    # Support new direction-based wholesale adjustments (increase/decrease)
    if is_wholesale and direction in ('increase', 'decrease'):
        try:
            # Validate variant exists in system (has at least one record)
            c.execute('''
                SELECT COUNT(*) AS cnt FROM inventory WHERE variant = ?
            ''', (variant,))
            variant_exists = int(_row_scalar(c.fetchone(), 'cnt') or 0)
            if variant_exists == 0 and direction == 'decrease':
                conn.close()
                return jsonify({"status": "error", "message": f"Product '{variant}' does not exist in inventory. Cannot adjust."}), 400

            if direction == 'decrease':
                # Lock and check stock
                c.execute('''
                    SELECT COALESCE(SUM(count), 0) AS current_stock
                    FROM inventory
                    WHERE deleted = 0 AND variant = ? AND (action='WHOLESALE' OR action='INVENTORY')
                    FOR UPDATE
                ''', (variant,))
                current_stock = int(_row_scalar(c.fetchone(), 'current_stock') or 0)

                if current_stock <= 0:
                    conn.rollback()
                    conn.close()
                    return jsonify({"status": "error", "message": f"No wholesale stock left for {variant}. Current: 0"}), 400

                if count > current_stock:
                    conn.rollback()
                    conn.close()
                    return jsonify({"status": "error", "message": f"Insufficient wholesale stock for {variant}. Available: {current_stock}, Requested: {count}"}), 400

            note_text = f"{reason}. " + (notes or "")
            now_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            insert_count = count if direction == 'increase' else -count
            c.execute('''
                INSERT INTO inventory (count, variant, date, notes, action)
                VALUES (?, ?, ?, ?, 'WHOLESALE')
            ''', (insert_count, variant, now_text, note_text))
            conn.commit()
        except Exception:
            conn.rollback()
            conn.close()
            raise
        finally:
            try:
                conn.close()
            except Exception:
                pass

        verb = "Increased" if direction == 'increase' else "Decreased"
        return jsonify({"status": "success", "message": f"{verb} wholesale storage: {count} {variant} ({reason})"})

    # Legacy flow: wholesale_action-based
    if is_wholesale and wholesale_action != 'OUT':
        conn.close()
        return jsonify({"status": "error", "message": "Wholesale adjustments support Sold/OUT only."}), 400

    try:
        # Begin transaction: lock relevant rows for this variant to avoid races.
        if is_wholesale:
            # Lock existing wholesale/inventory rows for this variant
            c.execute('''
                SELECT COALESCE(SUM(count), 0) AS current_stock
                FROM inventory
                WHERE deleted = 0 AND variant = ? AND (action='WHOLESALE' OR action='INVENTORY')
                FOR UPDATE
            ''', (variant,))
        else:
            c.execute('''
                SELECT COALESCE(SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END), 0) AS current_stock
                FROM inventory
                WHERE deleted = 0 AND variant = ? AND (action='IN' OR action='OUT')
                FOR UPDATE
            ''', (variant,))
        current_stock = int(_row_scalar(c.fetchone(), 'current_stock') or 0)

        if is_wholesale and wholesale_action == 'OUT':
            # Enforce wholesale minimum quantity per submit for OUT only.
            if count < 300:
                conn.rollback()
                conn.close()
                return jsonify({"status": "error", "message": f"Wholesale OUT requires at least 300 fish per submit. Requested: {count}"}), 400

            if current_stock <= 0:
                conn.rollback()
                conn.close()
                return jsonify({"status": "error", "message": f"No stock left for {variant}"}), 400

            if count > current_stock:
                conn.rollback()
                conn.close()
                return jsonify({"status": "error", "message": f"Insufficient stock for {variant}. Available: {current_stock}"}), 400

        note_text = f"{reason}. " + (notes or "")
        now_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if is_wholesale:
            insert_count = -count
            c.execute('''
                INSERT INTO inventory (count, variant, date, notes, action)
                VALUES (?, ?, ?, ?, 'WHOLESALE')
            ''', (insert_count, variant, now_text, note_text))
        else:
            c.execute('''
                INSERT INTO inventory (count, variant, date, notes, action)
                VALUES (?, ?, ?, ?, 'OUT')
            ''', (count, variant, now_text, note_text))
        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        raise
    finally:
        try:
            conn.close()
        except Exception:
            pass

    if is_wholesale:
        return jsonify({"status": "success", "message": f"Reduced wholesale storage: {count} {variant}"})
    return jsonify({"status": "success", "message": f"Recorded reduction: {count} {variant} ({reason})"})


@inventory_bp.route('/adjust_stock_batch', methods=['POST'])
def adjust_stock_batch():
    data = request.get_json(silent=True) or {}
    items = data.get("items", [])
    reason = data.get("reason", "Sold")
    notes = data.get("notes", "")
    source = str(data.get("source", "")).strip().lower()
    wholesale_action = str(data.get("wholesale_action", "OUT")).strip().upper()

    if not isinstance(items, list) or len(items) == 0:
        return jsonify({"status": "error", "message": "Select at least one variant"}), 400

    normalized = []
    for raw in items:
        if not isinstance(raw, dict):
            return jsonify({"status": "error", "message": "Invalid adjustment item"}), 400

        variant = str(raw.get("variant", "")).strip()
        if not variant:
            return jsonify({"status": "error", "message": "Variant is required"}), 400

        try:
            count = int(raw.get("count", 0))
        except Exception:
            return jsonify({"status": "error", "message": f"Invalid count for {variant}"}), 400

        if count <= 0:
            return jsonify({"status": "error", "message": f"Count must be greater than zero for {variant}"}), 400

        normalized.append((variant, count))

    is_wholesale = source == 'wholesale' or (not source and str(reason).strip().lower() == 'wholesale')
    is_died = str(reason).strip().lower() == 'died'

    if is_wholesale and wholesale_action != 'OUT':
        return jsonify({"status": "error", "message": "Wholesale adjustments support Sold/OUT only."}), 400
    total_requested = sum(count for _, count in normalized)
    if is_wholesale and wholesale_action == 'OUT' and not is_died and total_requested < 300:
        return jsonify({"status": "error", "message": f"Wholesale OUT requires at least 300 fish total per submit. Requested: {total_requested}"}), 400

    conn = get_db()
    c = conn.cursor()

    try:
        # Transactionally validate and insert per-variant to avoid races.
        for variant, count in normalized:
            if is_wholesale:
                c.execute('''
                    SELECT COALESCE(SUM(count), 0) AS current_stock
                    FROM inventory
                    WHERE deleted = 0 AND variant = ? AND (action='WHOLESALE' OR action='INVENTORY')
                    FOR UPDATE
                ''', (variant,))
            else:
                c.execute('''
                    SELECT COALESCE(SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END), 0) AS current_stock
                    FROM inventory
                    WHERE deleted = 0 AND variant = ? AND (action='IN' OR action='OUT')
                    FOR UPDATE
                ''', (variant,))
            current_stock = int(_row_scalar(c.fetchone(), 'current_stock') or 0)

            if is_wholesale and wholesale_action == 'OUT' and not is_died:
                if current_stock <= 0:
                    conn.rollback()
                    conn.close()
                    return jsonify({"status": "error", "message": f"No stock left for {variant}"}), 400

                if count > current_stock:
                    conn.rollback()
                    conn.close()
                    return jsonify({"status": "error", "message": f"Insufficient stock for {variant}. Available: {current_stock}"}), 400
            elif not is_wholesale and not is_died:
                if current_stock <= 0:
                    conn.rollback()
                    conn.close()
                    return jsonify({"status": "error", "message": f"No stock left for {variant}"}), 400

                if count > current_stock:
                    conn.rollback()
                    conn.close()
                    return jsonify({"status": "error", "message": f"Insufficient stock for {variant}. Available: {current_stock}"}), 400

            # perform insert for this variant
            now_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            note_text = f"{reason}. " + (notes or "")
            if is_wholesale:
                insert_count = -count
                c.execute('''
                    INSERT INTO inventory (count, variant, date, notes, action)
                    VALUES (?, ?, ?, ?, 'WHOLESALE')
                ''', (insert_count, variant, now_text, note_text))
            else:
                c.execute('''
                    INSERT INTO inventory (count, variant, date, notes, action)
                    VALUES (?, ?, ?, ?, 'OUT')
                ''', (count, variant, now_text, note_text))
        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        return jsonify({"status": "error", "message": "Failed to record adjustments"}), 500
    finally:
        try:
            conn.close()
        except Exception:
            pass
    total_count = sum(count for _, count in normalized)
    if is_wholesale:
        return jsonify({
            "status": "success",
            "message": f"Reduced wholesale storage for {len(normalized)} variant(s), total {total_count} fish"
        })
    return jsonify({
        "status": "success",
        "message": f"Recorded reductions for {len(normalized)} variant(s), total {total_count} fish ({reason})"
    })


@inventory_bp.route('/get_adjustments')
def get_adjustments():
    variant = request.args.get("variant", "").strip()
    start_date = request.args.get("start_date", "").strip()
    end_date = request.args.get("end_date", "").strip()
    month = request.args.get("month", "").strip()
    month_to = request.args.get("month_to", "").strip()
    year = request.args.get("year", "").strip()
    year_to = request.args.get("year_to", "").strip()
    source = request.args.get("source", "").strip().lower()
    search = request.args.get("search", "").strip()

    # exclude archived/deleted records from adjustments list
    where_clause = "WHERE deleted = 0"
    params = []
    conditions = []

    if search:
        conditions.append("LOWER(notes) LIKE ?")
        params.append(f"%{search.lower()}%")

    if source == 'tank':
        conditions.append("action='OUT'")
    elif source == 'wholesale':
        conditions.append("action='WHOLESALE'")
    elif source == 'all':
        pass  # no action filter — return everything
    else:
        conditions.append("(action='OUT' OR action='IN' OR action='WHOLESALE')")

    if variant:
        conditions.append("variant = ?")
        params.append(variant)

    # Prefer new start_date / end_date range over legacy month/year params
    if start_date or end_date:
        _date_re = re.compile(r'^\d{4}-\d{2}-\d{2}$')
        if start_date and _date_re.match(start_date) and end_date and _date_re.match(end_date):
            if start_date > end_date:
                start_date, end_date = end_date, start_date
            conditions.append("DATE(date) BETWEEN ? AND ?")
            params.extend([start_date, end_date])
        elif start_date and _date_re.match(start_date):
            conditions.append("DATE(date) >= ?")
            params.append(start_date)
        elif end_date and _date_re.match(end_date):
            conditions.append("DATE(date) <= ?")
            params.append(end_date)
    else:
        def _normalize_month(value: str, default: str) -> str:
            if not value:
                return default
            try:
                numeric = int(value)
                if numeric < 1:
                    numeric = 1
                if numeric > 12:
                    numeric = 12
                return f"{numeric:02d}"
            except Exception:
                return default

    if year or year_to:
        start_year = year or year_to
        end_year = year_to or year
        if start_year > end_year:
            start_year, end_year = end_year, start_year

        start_ym = f"{start_year}-{_normalize_month(month, '01')}"
        end_ym = f"{end_year}-{_normalize_month(month_to, '12')}"
        if start_ym > end_ym:
            start_ym, end_ym = end_ym, start_ym

        conditions.append(f"{_date_expr('%Y-%m')} BETWEEN ? AND ?")
        params.extend([start_ym, end_ym])
    elif month or month_to:
        start_month = _normalize_month(month, '01')
        end_month = _normalize_month(month_to, '12')
        if start_month > end_month:
            start_month, end_month = end_month, start_month
        conditions.append(f"{_date_expr('%m')} BETWEEN ? AND ?")
        params.extend([start_month, end_month])

    if conditions:
        where_clause += " AND " + " AND ".join(conditions)

    # Pagination support (optional)
    page_param = request.args.get("page", "").strip()
    per_page_param = request.args.get("per_page", "20").strip()

    conn = get_db()
    c = conn.cursor()

    if page_param:
        try:
            page = max(1, int(page_param))
            per_page = max(1, min(100, int(per_page_param)))
        except Exception:
            page, per_page = 1, 20

        count_query = f"SELECT COUNT(*) as total FROM inventory {where_clause}"
        c.execute(count_query, params)
        total = int(_row_scalar(c.fetchone(), 'total') or 0)
        total_pages = max(1, (total + per_page - 1) // per_page)
        offset = (page - 1) * per_page

        query = f"SELECT * FROM inventory {where_clause} ORDER BY id DESC LIMIT ? OFFSET ?"
        c.execute(query, params + [per_page, offset])
        records = c.fetchall()
        conn.close()

        items = []
        for row in records:
            action_value = row["action"] if "action" in row.keys() else "OUT"
            source_value = "Storage Box" if action_value == 'WHOLESALE' else "Fish Tank"
            items.append({
                "id": row["id"],
                "count": row["count"],
                "variant": row["variant"],
                "date": row["date"],
                "notes": row["notes"],
                "action": action_value,
                "source": source_value
            })
        return jsonify({"items": items, "total": total, "page": page, "per_page": per_page, "pages": total_pages})

    # Default: flat list (backward-compatible)
    query = f"SELECT * FROM inventory {where_clause} ORDER BY id DESC"
    c.execute(query, params)
    records = c.fetchall()
    conn.close()

    adjustments = []
    for row in records:
        action_value = row["action"] if "action" in row.keys() else "OUT"
        source_value = "Storage Box" if action_value == 'WHOLESALE' else "Fish Tank"
        adjustments.append({
            "id": row["id"],
            "count": row["count"],
            "variant": row["variant"],
            "date": row["date"],
            "notes": row["notes"],
            "action": action_value,
            "source": source_value
        })

    return jsonify(adjustments)


@inventory_bp.route('/get_wholesale_stock')
def get_wholesale_stock():
    """Return current wholesale stock per variant for adjustment form."""
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        SELECT variant, COALESCE(SUM(count), 0) AS stock
        FROM inventory
        WHERE deleted = 0 AND (action='WHOLESALE' OR action='INVENTORY')
        GROUP BY variant
        ORDER BY variant
    ''')
    rows = c.fetchall()
    conn.close()

    result = {}
    for row in rows:
        v = _row_value(row, 'variant', 0, '')
        s = int(_row_value(row, 'stock', 1, 0) or 0)
        if v:
            result[v] = max(0, s)
    return jsonify(result)


@inventory_bp.route('/adjustments_fragment')
def adjustments_fragment():
    return render_template('adjustments.html')


@inventory_bp.route('/get_years')
def get_years():
    conn = get_db()
    c = conn.cursor()
    c.execute(f"SELECT DISTINCT {_date_expr('%Y')} as year FROM inventory ORDER BY year DESC")
    years = [_row_value(row, 'year', 0, '') for row in c.fetchall()]
    conn.close()
    return jsonify({"years": years})


@inventory_bp.route('/get_deleted_records')
def get_deleted_records():
    conn = get_db()
    c = conn.cursor()
    
    variant = request.args.get("variant", "").strip()
    start_date = request.args.get("start_date", "").strip()
    end_date = request.args.get("end_date", "").strip()
    month = request.args.get("month", "")
    year = request.args.get("year", "")
    
    query = "SELECT id, count, variant, date, notes, action FROM inventory WHERE deleted = 1"
    params = []
    
    if variant:
        query += " AND variant = ?"
        params.append(variant)

    _date_re_local = re.compile(r'^\d{4}-\d{2}-\d{2}$')

    if start_date or end_date:
        if start_date and _date_re_local.match(start_date) and end_date and _date_re_local.match(end_date):
            if start_date > end_date:
                start_date, end_date = end_date, start_date
            query += " AND DATE(date) BETWEEN ? AND ?"
            params.extend([start_date, end_date])
        elif start_date and _date_re_local.match(start_date):
            query += " AND DATE(date) >= ?"
            params.append(start_date)
        elif end_date and _date_re_local.match(end_date):
            query += " AND DATE(date) <= ?"
            params.append(end_date)
    elif month and year:
        query += f" AND {_date_expr('%m')} = ? AND {_date_expr('%Y')} = ?"
        params.append(month.zfill(2))
        params.append(year)
    elif year:
        query += f" AND {_date_expr('%Y')} = ?"
        params.append(year)
    
    query += " ORDER BY id DESC"
    c.execute(query, params)
    records = [dict(row) for row in c.fetchall()]
    conn.close()
    
    return jsonify(records)


@inventory_bp.route('/restore_record/<int:record_id>', methods=['POST'])
def restore_record(record_id):
    conn = get_db()
    c = conn.cursor()

    c.execute('SELECT id, count, variant, action, notes, deleted FROM inventory WHERE id = ?', (record_id,))
    target = c.fetchone()
    if not target:
        conn.close()
        return jsonify({"success": False, "message": "Record not found"}), 404

    was_deleted = int(_row_value(target, 'deleted', 5, 0) or 0) == 1
    if not was_deleted:
        conn.close()
        return jsonify({"success": True, "message": "Record already active"})

    target_action = (_row_value(target, 'action', 3, '') or '').upper()
    target_count = int(_row_value(target, 'count', 1, 0) or 0)
    target_variant = _row_value(target, 'variant', 2, '')
    target_notes_clean = _strip_wholesale_link_marker(_row_value(target, 'notes', 4, ''))

    if target_action == 'WHOLESALE' and target_count < 0 and target_variant:
        c.execute('''
            SELECT COALESCE(SUM(count), 0) AS wholesale_balance
            FROM inventory
            WHERE deleted = 0 AND variant = ? AND action = 'WHOLESALE'
        ''', (target_variant,))
        wholesale_balance = int(_row_scalar(c.fetchone(), 'wholesale_balance') or 0)
        projected_balance = wholesale_balance + target_count
        if projected_balance < 0:
            conn.close()
            return jsonify({
                "success": False,
                "message": f"Cannot restore this wholesale sold record yet. Restore/add wholesale stock-in for {target_variant} first.",
                "required": abs(target_count),
                "available": wholesale_balance
            }), 400

    c.execute("UPDATE inventory SET deleted = 0, notes = ? WHERE id = ?", (target_notes_clean, record_id))

    restored_linked_ids = []
    if target_action == 'WHOLESALE' and target_count > 0 and target_variant:
        marker = _make_wholesale_link_marker(record_id)
        c.execute('''
            SELECT id, notes
            FROM inventory
            WHERE deleted = 1
              AND variant = ?
              AND action = 'WHOLESALE'
              AND count < 0
              AND notes LIKE ?
            ORDER BY date ASC, id ASC
        ''', (target_variant, f'%{marker}%'))
        linked_rows = c.fetchall()

        for linked_row in linked_rows:
            linked_id = int(_row_value(linked_row, 'id', 0, 0) or 0)
            if linked_id <= 0:
                continue
            linked_parent = _extract_wholesale_parent_link(_row_value(linked_row, 'notes', 1, ''))
            if linked_parent != record_id:
                continue
            cleaned_notes = _strip_wholesale_link_marker(_row_value(linked_row, 'notes', 1, ''))
            c.execute('UPDATE inventory SET deleted = 0, notes = ? WHERE id = ?', (cleaned_notes, linked_id))
            restored_linked_ids.append(linked_id)

    conn.commit()
    conn.close()

    if restored_linked_ids:
        return jsonify({
            "success": True,
            "message": f"Record restored successfully. Also restored {len(restored_linked_ids)} connected wholesale sold record(s).",
            "restored_linked_ids": restored_linked_ids
        })

    return jsonify({"success": True, "message": "Record restored successfully"})


# ---------- Low Stock Alert (filter-independent, real-time) ----------

# Default thresholds per variant; override via env LOW_STOCK_THRESHOLDS
# Format: "Black:20:40,Platinum:15:30,Pineapple:10:25"  (variant:critical:warning)
_DEFAULT_THRESHOLDS = {'_default': {'critical': 15, 'warning': 30}}

def _load_thresholds():
    thresholds = dict(_DEFAULT_THRESHOLDS)
    raw = os.environ.get('LOW_STOCK_THRESHOLDS', '').strip()
    if raw:
        for part in raw.split(','):
            tokens = part.strip().split(':')
            if len(tokens) == 3:
                variant, crit, warn = tokens[0].strip(), tokens[1].strip(), tokens[2].strip()
                try:
                    thresholds[variant] = {'critical': int(crit), 'warning': int(warn)}
                except ValueError:
                    pass
    return thresholds


@inventory_bp.route('/api/current-fish')
def get_current_fish():
    """Return real-time fish-in-tank counts per variant.

    Always unfiltered — reflects current stock independent of any dashboard
    date range or filter selections.
    """
    conn = get_db()
    c = conn.cursor()

    c.execute(
        "SELECT variant, "
        "SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END) as total "
        "FROM inventory WHERE deleted = 0 AND (action='IN' OR action='OUT') "
        "GROUP BY variant ORDER BY total DESC"
    )
    by_variant = []
    for row in c.fetchall():
        by_variant.append({
            "variant": _row_value(row, 'variant', 0),
            "count": _row_value(row, 'total', 1, 0),
        })

    c.execute(
        "SELECT SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END) as total "
        "FROM inventory WHERE deleted = 0 AND (action='IN' OR action='OUT')"
    )
    tank_total = _row_scalar(c.fetchone(), 'total') or 0

    conn.close()
    return jsonify({
        "tank_total": tank_total,
        "by_variant": by_variant
    })


@inventory_bp.route('/api/low-stock')
def get_low_stock():
    """Return current stock levels per variant with alert status.

    This endpoint is ALWAYS unfiltered — it reflects real-time stock,
    independent of any dashboard date range or filter selections.
    """
    conn = get_db()
    c = conn.cursor()

    # Current tank stock per variant (IN - OUT)
    c.execute('''
        SELECT variant,
               SUM(CASE WHEN action='IN' THEN count WHEN action='OUT' THEN -count ELSE 0 END) as stock
        FROM inventory
        WHERE deleted = 0 AND (action='IN' OR action='OUT')
        GROUP BY variant
        ORDER BY variant
    ''')
    tank_rows = c.fetchall()

    # Current wholesale stock per variant
    c.execute('''
        SELECT variant,
               SUM(count) as stock
        FROM inventory
        WHERE deleted = 0 AND (action='WHOLESALE' OR action='INVENTORY')
        GROUP BY variant
        ORDER BY variant
    ''')
    wholesale_rows = c.fetchall()

    conn.close()

    thresholds = _load_thresholds()
    alerts = []

    def _classify(variant_name, current_stock):
        t = thresholds.get(variant_name, thresholds['_default'])
        if current_stock <= t['critical']:
            return 'critical'
        if current_stock <= t['warning']:
            return 'warning'
        return 'ok'

    seen_variants = set()

    for row in tank_rows:
        v = _row_value(row, 'variant', 0, '')
        stock = int(_row_value(row, 'stock', 1, 0) or 0)
        t = thresholds.get(v, thresholds['_default'])
        alerts.append({
            'variant': v,
            'source': 'tank',
            'stock': stock,
            'status': _classify(v, stock),
            'threshold_critical': t['critical'],
            'threshold_warning': t['warning'],
        })
        seen_variants.add(('tank', v))

    for row in wholesale_rows:
        v = _row_value(row, 'variant', 0, '')
        stock = int(_row_value(row, 'stock', 1, 0) or 0)
        t = thresholds.get(v, thresholds['_default'])
        alerts.append({
            'variant': v,
            'source': 'wholesale',
            'stock': stock,
            'status': _classify(v, stock),
            'threshold_critical': t['critical'],
            'threshold_warning': t['warning'],
        })

    # Sort: critical first, then warning, then ok
    order = {'critical': 0, 'warning': 1, 'ok': 2}
    alerts.sort(key=lambda a: (order.get(a['status'], 9), a['variant']))

    return jsonify({'alerts': alerts})

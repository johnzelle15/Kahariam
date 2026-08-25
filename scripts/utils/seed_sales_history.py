#!/usr/bin/env python3
"""
Seed realistic back data so the Sales Trend chart and Analytics Overview have
something to draw.

Writes two kinds of WHOLESALE ledger rows, matching the conventions the app's
own read queries expect (see backend/api/inventory.py):

    stock in : action='WHOLESALE', count > 0, transaction_type='WHOLESALE_IN'
    sold     : action='WHOLESALE', count < 0, transaction_type='SOLD'

`/api/daily-trend` sums `count < 0` as units sold, so sales MUST be stored
negative or the chart reads them as stock arriving instead.

Sales are generated first (that's what the chart plots), then a delivery is
placed at the head of each block, large enough to cover it — so the running
balance never goes negative and the history reads like a real operation.

Usage (run from repository root):
    python scripts/utils/seed_sales_history.py                  # 10,000,000 sold over 6 months
    python scripts/utils/seed_sales_history.py 10000000 6
    python scripts/utils/seed_sales_history.py --dry-run        # generate + check, write nothing
"""

import sys
import os
import random
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.core.db import get_db  # noqa: E402

VARIANT = "SPIN_20"
PRICE = 0.40
DEFAULT_TOTAL = 10_000_000
DEFAULT_MONTHS = 6
BLOCK_DAYS = 10          # a delivery arrives roughly every 10 days
DELIVERY_BUFFER = 1.15   # stock a little more than the block will sell
QUIET_DAY_CHANCE = 0.10  # share of days with no sales at all
# Mon..Sun demand shape — market days midweek, quiet Sunday
WEEKDAY_SHAPE = [1.0, 1.15, 1.25, 1.1, 1.3, 0.9, 0.45]


def _daily_sales(total: int, days: int, end_date, rng) -> list[tuple]:
    """Return [(date, units_sold)] over `days` ending at `end_date`, summing to `total`."""
    dates = [end_date - timedelta(days=d) for d in range(days - 1, -1, -1)]

    weights = []
    for d in dates:
        if rng.random() < QUIET_DAY_CHANCE:
            weights.append(0.0)                      # closed / no orders
            continue
        w = WEEKDAY_SHAPE[d.weekday()] * rng.uniform(0.65, 1.35)
        if rng.random() < 0.04:
            w *= rng.uniform(2.0, 3.2)               # occasional bulk order
        weights.append(w)

    scale = total / sum(weights)
    counts = [int(w * scale) for w in weights]

    # Truncation always undershoots; hand the remainder to the biggest day.
    counts[counts.index(max(counts))] += total - sum(counts)
    return list(zip(dates, counts))


def _deliveries(sales: list[tuple], rng) -> list[tuple]:
    """One stock-in per BLOCK_DAYS block, sized to cover that block's sales."""
    out = []
    for i in range(0, len(sales), BLOCK_DAYS):
        block = sales[i:i + BLOCK_DAYS]
        needed = sum(n for _, n in block)
        if needed == 0:
            continue
        qty = int(needed * DELIVERY_BUFFER * rng.uniform(0.95, 1.08))
        out.append((block[0][0], qty))   # same day as the block's first sales
    return out


def _check(sales, deliveries, total):
    """Assert the generated history is internally valid before writing it."""
    assert sum(n for _, n in sales) == total, "sales must sum to the requested total"
    assert all(n >= 0 for _, n in sales), "sales cannot be negative"

    by_day = {}
    for d, n in deliveries:
        by_day[d] = by_day.get(d, 0) + n

    balance = 0
    for d, sold in sales:
        balance += by_day.get(d, 0) - sold
        assert balance >= 0, f"stock went negative on {d} ({balance})"
    return balance


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv

    total = int(args[0].replace(",", "").replace("_", "")) if args else DEFAULT_TOTAL
    months = int(args[1]) if len(args) > 1 else DEFAULT_MONTHS
    assert total > 0 and months > 0, "total and months must be positive"

    rng = random.Random(f"{VARIANT}-{total}-{months}")   # deterministic across reruns
    today = datetime.now().date()
    days = months * 30

    sales = _daily_sales(total, days, today, rng)
    deliveries = _deliveries(sales, rng)
    leftover = _check(sales, deliveries, total)

    stocked = sum(n for _, n in deliveries)
    active = [n for _, n in sales if n > 0]

    print(f"\n{VARIANT} — {months} months ({days} days), {sales[0][0]} → {sales[-1][0]}")
    print(f"  stocked in : {stocked:>12,} pcs  in {len(deliveries)} deliveries")
    print(f"  sold       : {total:>12,} pcs  over {len(active)} selling days")
    print(f"  revenue    : {'₱' + format(round(total * PRICE, 2), ',.2f'):>13}")
    print(f"  left       : {leftover:>12,} pcs")
    print(f"  busiest day: {max(active):>12,} pcs   quiet days: {len(sales) - len(active)}")

    if dry_run:
        print("\n--dry-run: nothing written.\n")
        return

    conn = get_db()
    c = conn.cursor()
    try:
        for when, qty in deliveries:
            c.execute(
                "INSERT INTO inventory (count, variant, date, notes, action, transaction_type) "
                "VALUES (?, ?, ?, ?, 'WHOLESALE', 'WHOLESALE_IN')",
                (qty, VARIANT, f"{when} 06:30:00", f"Wholesale delivery: +{qty:,}"),
            )
        for when, qty in sales:
            if qty == 0:
                continue
            c.execute(
                "INSERT INTO inventory (count, variant, date, notes, action, transaction_type, price, total_price) "
                "VALUES (?, ?, ?, ?, 'WHOLESALE', 'SOLD', ?, ?)",
                # The card already shows the count — a note repeating it is dead
                # space. Carry a reference instead.
                (-qty, VARIANT, f"{when} 14:00:00", f"Wholesale order WO-{when:%y%m%d}",
                 PRICE, round(qty * PRICE, 2)),
            )
        conn.commit()
        print(f"\nWrote {len(deliveries) + len(active)} rows.\n")
    except Exception as exc:
        conn.rollback()
        print(f"\n[ERROR] Rolled back: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Add wholesale stock to the inventory database.

Inserts WHOLESALE ledger rows.  Because inventory is append-only, inserting a
positive row always ADDS to the running balance (no duplicates are created,
and the old balance is preserved).

Usage (run from repository root):
    python scripts/utils/add_wholesale_stock.py                     # DEFAULT_QTY, dated now
    python scripts/utils/add_wholesale_stock.py 10000000            # given qty, dated now
    python scripts/utils/add_wholesale_stock.py 10000000 2026-08-01 # backdated to one date
    python scripts/utils/add_wholesale_stock.py 10000000 6mo        # spread over 6 months of
                                                                    # deliveries, summing exactly
"""

import sys
import os
import random
from datetime import datetime, timedelta

# ── allow importing from the project root ────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.core.db import get_db  # noqa: E402  (import after sys.path setup)

# ── stock to add ──────────────────────────────────────────────────────────────
VARIANT = "SPIN_20"
DEFAULT_QTY = 1500
DELIVERY_EVERY_DAYS = 10   # a farm restocks in batches, not continuously


# ─────────────────────────────────────────────────────────────────────────────

def _validate_qty(qty: int) -> None:
    """Raise ValueError for a non-positive quantity."""
    if not isinstance(qty, int) or qty <= 0:
        raise ValueError(f"Invalid quantity: {qty!r} — must be a positive integer.")


def _current_balance(cursor, variant: str) -> int:
    """Return the current wholesale balance for a variant (may be negative)."""
    cursor.execute(
        """
        SELECT COALESCE(SUM(count), 0) AS balance
        FROM inventory
        WHERE deleted = 0 AND variant = ? AND action = 'WHOLESALE'
        """,
        (variant,),
    )
    row = cursor.fetchone()
    if row is None:
        return 0
    if isinstance(row, dict):
        return int(row.get("balance") or 0)
    return int(row[0] or 0)


def _deliveries(total: int, months: int, end: datetime) -> list[tuple[datetime, int]]:
    """Split `total` into varied deliveries every ~DELIVERY_EVERY_DAYS over `months`.

    Sizes vary so the history doesn't look machine-generated; the last batch
    absorbs the rounding remainder so the batches sum to `total` exactly.
    """
    rng = random.Random(f"{VARIANT}-{total}-{months}")  # deterministic: reruns match
    dates = [
        end - timedelta(days=d, hours=rng.randrange(0, 9), minutes=rng.randrange(0, 60))
        for d in range(months * 30, 0, -DELIVERY_EVERY_DAYS)
    ]
    weights = [rng.uniform(0.55, 1.45) for _ in dates]
    scale = total / sum(weights)
    counts = [max(1, int(w * scale)) for w in weights]
    counts[-1] += total - sum(counts)  # truncation only ever undershoots
    return sorted(zip(dates, counts))


def _insert_wholesale(cursor, variant: str, qty: int, when: datetime) -> None:
    cursor.execute(
        """
        INSERT INTO inventory (count, variant, date, notes, action)
        VALUES (?, ?, ?, ?, 'WHOLESALE')
        """,
        (qty, variant, when.strftime("%Y-%m-%d %H:%M:%S"),
         f"Wholesale delivery: +{qty:,}"),
    )


def _print_table(rows: list[dict], running_start: int) -> None:
    """Print a formatted ASCII table of the inserted deliveries."""
    headers = ["Date", "Added", "Balance After"]
    body = []
    running = running_start
    for r in rows:
        running += r["added"]
        body.append([r["date"].strftime("%Y-%m-%d"), f"{r['added']:,}", f"{running:,}"])

    widths = [max(len(h), *(len(b[i]) for b in body)) for i, h in enumerate(headers)]
    sep = "+-" + "-+-".join("-" * w for w in widths) + "-+"
    fmt = "| " + " | ".join(f"{{:<{w}}}" for w in widths) + " |"

    print(sep)
    print(fmt.format(*headers))
    print(sep)
    for b in body:
        print(fmt.format(*b))
    print(sep)


def _parse_when(arg: str, total: int) -> list[tuple[datetime, int]]:
    """Second CLI arg: '6mo' spreads over months, otherwise a single date."""
    if arg.endswith("mo"):
        return _deliveries(total, int(arg[:-2]), datetime.now())
    fmt = "%Y-%m-%d %H:%M:%S" if " " in arg else "%Y-%m-%d"
    return [(datetime.strptime(arg, fmt), total)]


def main() -> None:
    qty = int(sys.argv[1].replace(",", "").replace("_", "")) if len(sys.argv) > 1 else DEFAULT_QTY
    _validate_qty(qty)

    batches = _parse_when(sys.argv[2], qty) if len(sys.argv) > 2 else [(datetime.now(), qty)]
    assert sum(c for _, c in batches) == qty, "batches must sum to the requested quantity"

    conn = get_db()
    c = conn.cursor()

    try:
        prev = _current_balance(c, VARIANT)
        for when, count in batches:
            _insert_wholesale(c, VARIANT, count, when)

        conn.commit()
        print(f"\n{VARIANT}: {len(batches)} delivery row(s), +{qty:,} pcs total\n")
        _print_table([{"date": w, "added": n} for w, n in batches], prev)
        print(f"\nPrevious balance: {prev:,}    New balance: {prev + qty:,}\n")

    except Exception as exc:
        conn.rollback()
        print(f"\n[ERROR] Transaction rolled back: {exc}", file=sys.stderr)
        sys.exit(1)

    finally:
        conn.close()


if __name__ == "__main__":
    main()

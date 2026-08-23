#!/usr/bin/env python3
"""
Add wholesale stock to the inventory database.

Inserts WHOLESALE ledger rows for each variant.  Because inventory is
append-only, inserting a positive row always ADDS to the running balance
(no duplicates are created, and the old balance is preserved).

Usage (run from repository root):
    python scripts/utils/add_wholesale_stock.py

Optionally override variants / quantities via the STOCK dict below.
"""

import sys
import os
from datetime import datetime

# ── allow importing from the project root ────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.core.db import get_db  # noqa: E402  (import after sys.path setup)

# ── stock to add ──────────────────────────────────────────────────────────────
STOCK: dict[str, int] = {
    "SPIN_20": 1500,
}

NOTES = "Manual stock addition: +1500 wholesale"


# ─────────────────────────────────────────────────────────────────────────────

def _validate_stock(stock: dict[str, int]) -> None:
    """Raise ValueError for any non-positive quantity."""
    for variant, qty in stock.items():
        if not isinstance(qty, int) or qty <= 0:
            raise ValueError(
                f"Invalid quantity for '{variant}': {qty!r} — must be a positive integer."
            )
        if not variant or not variant.strip():
            raise ValueError("Variant name must not be empty.")


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


def _insert_wholesale(cursor, variant: str, qty: int, now: str) -> None:
    cursor.execute(
        """
        INSERT INTO inventory (count, variant, date, notes, action)
        VALUES (?, ?, ?, ?, 'WHOLESALE')
        """,
        (qty, variant, now, NOTES),
    )


def _print_table(rows: list[dict]) -> None:
    """Print a formatted ASCII table."""
    headers = ["Variant", "Added", "Previous Balance", "New Balance"]
    col_widths = [len(h) for h in headers]

    for r in rows:
        col_widths[0] = max(col_widths[0], len(r["variant"]))
        col_widths[1] = max(col_widths[1], len(str(r["added"])))
        col_widths[2] = max(col_widths[2], len(str(r["prev_balance"])))
        col_widths[3] = max(col_widths[3], len(str(r["new_balance"])))

    sep = "+-" + "-+-".join("-" * w for w in col_widths) + "-+"
    fmt = "| " + " | ".join(f"{{:<{w}}}" for w in col_widths) + " |"

    print(sep)
    print(fmt.format(*headers))
    print(sep)
    for r in rows:
        print(fmt.format(r["variant"], r["added"], r["prev_balance"], r["new_balance"]))
    print(sep)


def main() -> None:
    # 1. Validate inputs before touching the database
    _validate_stock(STOCK)

    conn = get_db()
    c = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    results: list[dict] = []

    try:
        for variant, qty in STOCK.items():
            prev = _current_balance(c, variant)
            _insert_wholesale(c, variant, qty, now)
            new_bal = prev + qty
            results.append({
                "variant":      variant,
                "added":        qty,
                "prev_balance": prev,
                "new_balance":  new_bal,
            })

        conn.commit()
        print(f"\nWholesale stock updated successfully — {now}\n")
        _print_table(results)
        print()

    except Exception as exc:
        conn.rollback()
        print(f"\n[ERROR] Transaction rolled back: {exc}", file=sys.stderr)
        sys.exit(1)

    finally:
        conn.close()


if __name__ == "__main__":
    main()

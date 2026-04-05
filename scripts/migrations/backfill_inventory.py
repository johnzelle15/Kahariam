#!/usr/bin/env python3
"""
Generate inventory back data for Fish-Counter.

Default range: 2025-01-01 to 2026-02-28 (inclusive)
Usage:
  python scripts/backfill_inventory.py
  python scripts/backfill_inventory.py --start 2025-01-01 --end 2026-02-28 --seed 42
    python scripts/backfill_inventory.py --replace-range
"""

from __future__ import annotations

import argparse
import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.db import get_db


VARIANTS = ["Black", "Platinum", "Pineapple"]

MONTH_FACTORS = {
    1: 0.95,
    2: 0.90,
    3: 1.05,
    4: 1.10,
    5: 1.15,
    6: 1.25,
    7: 1.30,
    8: 1.35,
    9: 1.20,
    10: 1.10,
    11: 1.18,
    12: 1.28,
}

VARIANT_WEIGHTS = {
    "Black": 0.38,
    "Platinum": 0.34,
    "Pineapple": 0.28,
}

OUT_MONTH_MULTIPLIERS = {
    3: 1.20,
    4: 1.35,
    5: 1.55,
    6: 1.50,
    7: 1.35,
    8: 1.25,
}

OUT_REASON_WEIGHTS = (
    ("Backfill sold", 0.78),
    ("Backfill died", 0.22),
)


@dataclass
class Row:
    count: int
    variant: str
    date: datetime
    notes: str
    action: str
    deleted: int = 0


def month_start(dt: datetime) -> datetime:
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def next_month(dt: datetime) -> datetime:
    if dt.month == 12:
        return dt.replace(year=dt.year + 1, month=1, day=1)
    return dt.replace(month=dt.month + 1, day=1)


def random_datetime_in_month(rng: random.Random, year: int, month: int) -> datetime:
    start = datetime(year, month, 1)
    end = next_month(start)
    seconds = int((end - start).total_seconds())
    offset = rng.randint(0, max(seconds - 1, 0))
    return start + timedelta(seconds=offset)


def weighted_variant(rng: random.Random) -> str:
    pick = rng.random()
    cumulative = 0.0
    for variant in VARIANTS:
        cumulative += VARIANT_WEIGHTS[variant]
        if pick <= cumulative:
            return variant
    return VARIANTS[-1]


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(value, high))


def weighted_out_note(rng: random.Random, month_label: str) -> str:
    pick = rng.random()
    cumulative = 0.0
    for label, weight in OUT_REASON_WEIGHTS:
        cumulative += weight
        if pick <= cumulative:
            return f"{label} ({month_label})"
    return f"Backfill sold ({month_label})"


def generate_rows(start: datetime, end: datetime, seed: int) -> list[Row]:
    rng = random.Random(seed)
    rows: list[Row] = []

    cursor = month_start(start)
    while cursor <= end:
        year, month = cursor.year, cursor.month
        month_factor = MONTH_FACTORS.get(month, 1.0)
        out_month_factor = OUT_MONTH_MULTIPLIERS.get(month, 1.0)

        in_records = clamp(int(round(rng.randint(5, 8) * month_factor)), 4, 12)
        out_records = clamp(
            int(round(rng.randint(3, 6) * (0.78 + month_factor * 0.38) * out_month_factor)),
            1,
            12,
        )

        in_note = f"Backfill stock-in ({cursor.strftime('%b %Y')})"
        month_label = cursor.strftime('%b %Y')

        for _ in range(in_records):
            variant = weighted_variant(rng)
            base_in = rng.randint(28, 85)
            count = clamp(int(round(base_in * month_factor + rng.randint(-8, 10))), 18, 160)
            rows.append(
                Row(
                    count=count,
                    variant=variant,
                    date=random_datetime_in_month(rng, year, month),
                    notes=in_note,
                    action="IN",
                )
            )

        for _ in range(out_records):
            variant = weighted_variant(rng)
            base_out = rng.randint(10, 42)
            count = clamp(
                int(round(base_out * (0.9 + month_factor * 0.28) * (0.95 + (out_month_factor - 1.0) * 0.9) + rng.randint(-4, 8))),
                3,
                90,
            )
            rows.append(
                Row(
                    count=count,
                    variant=variant,
                    date=random_datetime_in_month(rng, year, month),
                    notes=weighted_out_note(rng, month_label),
                    action="OUT",
                )
            )

        cursor = next_month(cursor)

    rows = [r for r in rows if start <= r.date <= end.replace(hour=23, minute=59, second=59, microsecond=999999)]
    rows.sort(key=lambda r: r.date)
    return rows


def insert_rows(rows: list[Row]) -> int:
    conn = get_db()
    cur = conn.cursor()

    sql = (
        "INSERT INTO inventory (count, variant, date, notes, action, deleted) "
        "VALUES (?, ?, ?, ?, ?, ?)"
    )

    params = [
        (
            row.count,
            row.variant,
            row.date.strftime("%Y-%m-%d %H:%M:%S"),
            row.notes,
            row.action,
            row.deleted,
        )
        for row in rows
    ]

    cur.executemany(sql, params)
    inserted = cur.rowcount if getattr(cur, "rowcount", None) is not None else len(rows)
    conn.commit()
    conn.close()
    return inserted


def delete_rows_in_range(start: datetime, end: datetime) -> int:
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM inventory WHERE date >= ? AND date < ?",
        (
            start.strftime("%Y-%m-%d 00:00:00"),
            (end + timedelta(days=1)).strftime("%Y-%m-%d 00:00:00"),
        ),
    )
    deleted = cur.rowcount if getattr(cur, "rowcount", None) is not None else 0
    conn.commit()
    conn.close()
    return deleted


def parse_date(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2025-01-01", help="Start date YYYY-MM-DD")
    parser.add_argument("--end", default="2026-02-28", help="End date YYYY-MM-DD")
    parser.add_argument("--seed", type=int, default=2026, help="Random seed")
    parser.add_argument(
        "--replace-range",
        action="store_true",
        help="Delete existing inventory rows inside range before inserting new backfill data",
    )
    args = parser.parse_args()

    start = parse_date(args.start)
    end = parse_date(args.end)

    if end < start:
        raise ValueError("--end must be on or after --start")

    deleted = 0
    if args.replace_range:
        deleted = delete_rows_in_range(start, end)

    rows = generate_rows(start, end, args.seed)
    inserted = insert_rows(rows)

    if args.replace_range:
        print(f"Deleted {deleted} existing inventory record(s) in range")
    print(f"Inserted {inserted} inventory records")
    print(f"Range: {args.start} to {args.end}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

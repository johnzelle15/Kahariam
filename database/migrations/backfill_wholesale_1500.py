#!/usr/bin/env python3
"""
Backfill wholesale storage with 1500 pcs per variant.
Run from repository root:

    python scripts/backfill_wholesale_1500.py

This script uses the project's `backend.db.get_db()` to connect to the configured MariaDB and
inserts positive `WHOLESALE` inventory rows for each variant: Black, Platinum, Pineapple.
"""
from datetime import datetime
from backend.core.db import get_db

VARIANTS = ["Black", "Platinum", "Pineapple"]
AMOUNT = 1500


def main():
    conn = get_db()
    c = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    inserted = []
    try:
        for v in VARIANTS:
            c.execute('''
                INSERT INTO inventory (count, variant, date, notes, action)
                VALUES (?, ?, ?, ?, 'WHOLESALE')
            ''', (AMOUNT, v, now, 'Backfill: +1500 wholesale'))
            inserted.append(v)
        conn.commit()
    except Exception as e:
        conn.rollback()
        print('Error during backfill:', e)
    finally:
        conn.close()

    if inserted:
        print('Inserted wholesale backfill for variants:', ', '.join(inserted))
    else:
        print('No rows inserted.')


if __name__ == '__main__':
    main()

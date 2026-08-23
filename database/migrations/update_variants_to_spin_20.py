"""Collapse the legacy Black/Pineapple/Platinum fish-color variants into a
single SPIN_20 variant across all inventory rows."""
from backend.core.db import get_db

OLD_VARIANTS = ('black', 'pineapple', 'platinum')


def _first_val(row):
    if row is None:
        return 0
    if isinstance(row, dict):
        return next(iter(row.values()))
    return row[0]

conn = get_db()
c = conn.cursor()
try:
    placeholders = ','.join('?' * len(OLD_VARIANTS))
    c.execute(f"SELECT COUNT(*) AS cnt FROM inventory WHERE LOWER(variant) IN ({placeholders})", OLD_VARIANTS)
    before = _first_val(c.fetchone())
    print('Old-variant rows before:', before)
    if before > 0:
        c.execute(f"UPDATE inventory SET variant='SPIN_20' WHERE LOWER(variant) IN ({placeholders})", OLD_VARIANTS)
        conn.commit()
    c.execute(f"SELECT COUNT(*) AS cnt FROM inventory WHERE LOWER(variant) IN ({placeholders})", OLD_VARIANTS)
    after = _first_val(c.fetchone())
    c.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE variant='SPIN_20'")
    spin_20 = _first_val(c.fetchone())
    print('Old-variant rows after:', after)
    print('SPIN_20 rows now:', spin_20)
except Exception as e:
    print('Error:', e)
finally:
    conn.close()

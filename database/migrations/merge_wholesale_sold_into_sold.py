"""Merge the WHOLESALE_SOLD transaction_type into a single generic SOLD
type, now that the company only sells wholesale (no more retail/Tank
sales to distinguish it from)."""
from backend.core.db import get_db


def _first_val(row):
    if row is None:
        return 0
    if isinstance(row, dict):
        return next(iter(row.values()))
    return row[0]

conn = get_db()
c = conn.cursor()
try:
    c.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE transaction_type = 'WHOLESALE_SOLD'")
    before = _first_val(c.fetchone())
    print('WHOLESALE_SOLD rows before:', before)
    if before > 0:
        c.execute("UPDATE inventory SET transaction_type = 'SOLD' WHERE transaction_type = 'WHOLESALE_SOLD'")
        conn.commit()
    c.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE transaction_type = 'WHOLESALE_SOLD'")
    after = _first_val(c.fetchone())
    c.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE transaction_type = 'SOLD'")
    sold = _first_val(c.fetchone())
    print('WHOLESALE_SOLD rows after:', after)
    print('SOLD rows now:', sold)
except Exception as e:
    print('Error:', e)
finally:
    conn.close()

"""Merge the TANK_IN transaction_type into WHOLESALE_IN, now that the
company only sells wholesale — there's no more Fish Tank inflow to
distinguish it from."""
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
    c.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE transaction_type = 'TANK_IN'")
    before = _first_val(c.fetchone())
    print('TANK_IN rows before:', before)
    if before > 0:
        c.execute("UPDATE inventory SET transaction_type = 'WHOLESALE_IN' WHERE transaction_type = 'TANK_IN'")
        conn.commit()
    c.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE transaction_type = 'TANK_IN'")
    after = _first_val(c.fetchone())
    c.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE transaction_type = 'WHOLESALE_IN'")
    wholesale_in = _first_val(c.fetchone())
    print('TANK_IN rows after:', after)
    print('WHOLESALE_IN rows now:', wholesale_in)
except Exception as e:
    print('Error:', e)
finally:
    conn.close()

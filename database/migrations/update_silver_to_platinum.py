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
    c.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE LOWER(variant)='silver'")
    before = _first_val(c.fetchone())
    print('Silver rows before:', before)
    if before > 0:
        c.execute("UPDATE inventory SET variant='Platinum' WHERE LOWER(variant)='silver'")
        conn.commit()
    c.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE LOWER(variant)='silver'")
    after = _first_val(c.fetchone())
    c.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE LOWER(variant)='platinum'")
    platinum = _first_val(c.fetchone())
    print('Silver rows after:', after)
    print('Platinum rows now:', platinum)
except Exception as e:
    print('Error:', e)
finally:
    conn.close()

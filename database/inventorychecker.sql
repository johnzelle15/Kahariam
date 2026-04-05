SELECT id, count, variant, date, notes, action, deleted
FROM inventory
ORDER BY id DESC
LIMIT 50;
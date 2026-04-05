# Fish-Counter Code Review Guide

This guide is for quick code walkthrough and review.

## 1) Fast entry points

Start in this order:

1. `app.py` - app bootstrap, extensions, blueprints, frontend route fallback
2. `backend/config.py` - all runtime config/env flags
3. `backend/db.py` - DB connection and schema init behavior
4. `backend/runtime.py` - process/shared state used by blueprints
5. `backend/*.py` blueprints - API behavior by domain

## 2) Backend API map (route -> file)

### Counting
- `/start` -> `backend/counting.py` (route near line 11)
- `/stop` -> `backend/counting.py` (route near line 49)
- `/get_count` -> `backend/counting.py` (route near line 85)
- `/get_state` -> `backend/counting.py` (route near line 91)
- `/update_count` -> `backend/counting.py` (route near line 97)

### Ingest
- `/api/v1/ingest` -> `backend/ingest.py` (route near line 10)

### Devices
- `/api/v1/devices/register` -> `backend/devices.py` (route near line 7)
- `/devices` -> `backend/devices.py` (route near line 37)
- `/api/v1/devices` -> `backend/devices.py` (route near line 43)
- `/api/v1/devices/<device_id>/revoke` -> `backend/devices.py` (route near line 66)
- `/api/v1/devices/<device_id>/activate` -> `backend/devices.py` (route near line 83)

### Locks
- `/api/v1/devices/<device_id>/lock` -> `backend/locks.py` (route near line 45)
- `/api/v1/devices/<device_id>/unlock` -> `backend/locks.py` (route near line 62)
- `/api/v1/devices/<device_id>/lock_status` -> `backend/locks.py` (route near line 89)

### Inventory (large module)
- `/save_inventory` -> `backend/inventory.py` (route near line 117)
- `/get_inventory` -> `backend/inventory.py` (route near line 149)
- `/delete_inventory/<int:id>` -> `backend/inventory.py` (route near line 223)
- `/clear_inventory` -> `backend/inventory.py` (route near line 293)
- `/get_statistics` -> `backend/inventory.py` (route near line 305)
- `/get_monthly_tank` -> `backend/inventory.py` (route near line 452)
- `/get_monthly_tank_by_variant` -> `backend/inventory.py` (route near line 491)
- `/get_time_series` -> `backend/inventory.py` (route near line 533)
- `/get_time_series_by_variant` -> `backend/inventory.py` (route near line 592)
- `/add_to_tank` -> `backend/inventory.py` (route near line 685)
- `/adjust_stock` -> `backend/inventory.py` (route near line 710)
- `/adjust_stock_batch` -> `backend/inventory.py` (route near line 801)
- `/get_adjustments` -> `backend/inventory.py` (route near line 918)
- `/adjustments_fragment` -> `backend/inventory.py` (route near line 1004)
- `/get_years` -> `backend/inventory.py` (route near line 1009)
- `/get_deleted_records` -> `backend/inventory.py` (route near line 1019)
- `/restore_record/<int:record_id>` -> `backend/inventory.py` (route near line 1050)

## 3) Frontend review order

1. `frontend/src/main.jsx` - app mount
2. `frontend/src/App.jsx` - top-level layout/router shell
3. `frontend/src/components/Nav.jsx` and `Sidebar.jsx` - navigation flow
4. Domain components:
   - `Dashboard.jsx`
   - `Counter.jsx`
   - `Inventory.jsx`
   - `Adjustments.jsx`

## 4) Templates and static (legacy/hybrid pages)

- `templates/` - Jinja templates (`base.html`, `dashboard.html`, etc.)
- `static/` - JS/CSS assets for non-React pages

## 5) Quick search commands for review

Use these in terminal from project root:

- List all Flask routes:
  - `Select-String -Path backend\*.py -Pattern "@\w+_bp\.route\("`
- List all function definitions:
  - `Select-String -Path backend\*.py -Pattern "^def\s+"`
- Find where a route handler name is defined:
  - `Select-String -Path backend\*.py -Pattern "def\s+get_statistics\("`

## 6) Suggested next structural split (optional)

If you want cleaner review and smaller files next, split `backend/inventory.py` into:

- `backend/inventory_routes.py` - route handlers only
- `backend/inventory_queries.py` - SQL/query builders
- `backend/inventory_services.py` - business rules (adjust/restore/cascade)
- `backend/inventory_utils.py` - helper functions (`_row_value`, date period helpers, marker parsing)

This guide keeps your current behavior intact while giving a consistent review path.
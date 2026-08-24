# Fish Counter — Project Architecture

## Directory Structure

```
Fish-Counter/
├── app.py                    # Root entry point (Flask + SocketIO)
├── run_app.py                # Alt entry point with config
├── run_counter.py            # Vision-only entry point
├── rpi5_inference.py         # Standalone RPi 5 inference demo
├── requirements.txt
├── .env.example
│
├── backend/                  # Flask web application
│   ├── __init__.py
│   ├── app.py                # App factory: create_app(), socketio
│   ├── core/
│   │   ├── __init__.py       # Re-exports config, db, runtime
│   │   ├── config.py         # Env vars, paths, feature flags
│   │   ├── db.py             # MariaDB connection pool, init_db()
│   │   └── runtime.py        # RuntimeState dataclass, get_runtime()
│   └── api/
│       ├── __init__.py       # Blueprint registration
│       ├── auth.py           # Device token verification
│       ├── counting.py       # Start/stop counter subprocess
│       ├── devices.py        # Device management CRUD
│       ├── ingest.py         # Fish count ingest endpoint
│       ├── inventory.py      # Inventory ledger queries
│       └── locks.py          # Concurrent access locks
│
├── vision/                   # Computer vision / ML inference
│   ├── __init__.py           # Re-exports CentroidTracker, TrackedObject
│   ├── fish_counter.py       # Main counting loop (ONNX + camera)
│   └── tracker.py            # Centroid tracker algorithm
│
├── models/                   # Trained model weights
│   ├── fish_detector.onnx    # Active model (YOLOv11n 480×480)
│   └── fish_detector.pt      # PyTorch equivalent
│
├── database/                 # SQL schemas, migrations, seeds
│   ├── schema.sql            # Authoritative DDL — matches the live DB
│   ├── planned_schema.sql    # Future-work tables (documentation, do not run)
│   ├── migrations/           # Historical migration record
│   └── seeds/                # Seed data
│
├── frontend/                 # React 18 SPA (Vite + Tailwind)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── components/       # Dashboard, Counter, Inventory, etc.
│   │   └── store/            # Zustand state management
│   └── dist/                 # Built assets (served by Flask)
│
├── templates/                # Legacy Jinja2 templates (fallback)
├── static/                   # Legacy static assets
│
├── evaluation/               # Model evaluation tools + test videos
│   ├── evaluate_models.py
│   ├── test_video.py
│   └── videos/               # Test clips (black, pineapple, platinum)
│
├── training/                 # YOLO training artifacts
│   ├── datasets/             # Training data
│   ├── preprocess/           # Data preparation logs/reports
│   └── runs/                 # Training runs, exports, validations
│
├── scripts/                  # Operational scripts
│   ├── run_server.sh         # Production launcher
│   ├── setup/                # RPi 5 first-time setup
│   ├── utils/                # One-off data utilities
│   └── dev/                  # Dev-only helpers
│
├── runtime/                  # Runtime data (logs, backups)
├── tests/                    # Test suite
└── docs/                     # Documentation
```

## Package Import Map

| From              | Import As            | Contains                              |
|-------------------|----------------------|---------------------------------------|
| `backend.app`     | `app, socketio`      | Flask factory, SocketIO instance      |
| `backend.core`    | `config, db, runtime`| Config, DB pool, runtime state        |
| `backend.api`     | `*_bp`               | All Flask blueprints                  |
| `vision`          | `CentroidTracker`    | Tracker + counting logic              |

## Running

```bash
# Web app (Flask + React SPA)
python app.py
# or
python run_app.py

# Vision counter only
python run_counter.py

# Production (RPi 5)
bash scripts/run_server.sh

# With gunicorn (threading async_mode: 1 worker for Socket.IO's shared
# state, with threads enabled on it)
gunicorn --workers 1 --threads 100 -b 0.0.0.0:5000 'backend.app:app'
```

## Key Design Decisions

- **backend/** is a pure Python package — all internal imports use `backend.*`
- **vision/** is a separate package — imports use `vision.*` for ML code, `backend.core.config` for shared config
- **Root entry points** (`app.py`, `run_app.py`, `run_counter.py`) are thin wrappers
- **counting.py** spawns `vision/fish_counter.py` as a subprocess (camera isolation)
- **MariaDB** is the sole database — no SQLite fallback
- **React SPA** is the primary UI; Jinja2 templates are a legacy fallback
- **Class order**: `{0: Black, 1: Pineapple, 2: Platinum}` (alphabetical, from training)

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIST_DIR = PROJECT_ROOT / 'frontend' / 'dist'
TEMPLATES_DIR = PROJECT_ROOT / 'templates'
STATIC_DIR = PROJECT_ROOT / 'static'

FLASK_SECRET_KEY = os.environ.get('FLASK_SECRET_KEY', 'dev-secret-key')
CSP_CDN_HOSTS = os.environ.get('CSP_CDN_HOSTS', 'https://cdn.socket.io https://cdn.jsdelivr.net')

APP_HOST = os.environ.get('APP_HOST', '0.0.0.0')
APP_PORT = int(os.environ.get('APP_PORT', '5000'))

INGEST_URL = os.environ.get('INGEST_URL', 'http://127.0.0.1:5000/api/v1/ingest')
LEGACY_UPDATE_COUNT_URL = os.environ.get('LEGACY_UPDATE_COUNT_URL', 'http://127.0.0.1:5000/update_count')


def is_debug_enabled(default: bool = True) -> bool:
    raw = os.environ.get('APP_DEBUG')
    if raw is None:
        return default
    return raw.strip().lower() in {'1', 'true', 'yes', 'on'}

# Fish Counter - API blueprints
from backend.api.auth import verify_device_token
from backend.api.counting import counting_bp
from backend.api.devices import devices_bp
from backend.api.ingest import ingest_bp
from backend.api.inventory import inventory_bp
from backend.api.locks import locks_bp
from backend.api.settings import settings_bp

__all__ = [
    'verify_device_token',
    'counting_bp',
    'devices_bp',
    'ingest_bp',
    'inventory_bp',
    'locks_bp',
    'settings_bp',
]

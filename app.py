#!/usr/bin/env python
"""
Root-level wrapper for Fish Counter application.
Imports and runs the app from backend/ package.
"""
import sys
from pathlib import Path

# Add project root to path so package imports work
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backend.app import app, socketio

if __name__ == "__main__":
    import os
    host = os.environ.get("APP_HOST", "0.0.0.0")
    port = int(os.environ.get("APP_PORT", 5000))
    debug = os.environ.get("APP_DEBUG", "false").lower() in ("1", "true", "yes", "on")
    socketio.run(app, host=host, port=port, debug=debug, allow_unsafe_werkzeug=True)

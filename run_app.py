#!/usr/bin/env python3
"""
Fish Counter - Web Application Entry Point

Usage:
    python run_app.py
    
Or with gunicorn:
    gunicorn -k eventlet -w 1 -b 0.0.0.0:5000 'backend.app:app'
"""

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    from backend.app import app, socketio
    from backend.core.config import APP_HOST, APP_PORT, is_debug_enabled
    
    print("=" * 50)
    print("FISH COUNTER - WEB APPLICATION")
    print("=" * 50)
    print(f"Starting server at http://{APP_HOST}:{APP_PORT}")
    
    socketio.run(app, host=APP_HOST, port=APP_PORT, debug=is_debug_enabled())

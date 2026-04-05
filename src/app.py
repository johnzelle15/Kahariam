import os
from typing import Callable

from flask import Flask, render_template, send_from_directory
from flask_socketio import SocketIO

from src.core.config import (
    APP_HOST,
    APP_PORT,
    CSP_CDN_HOSTS,
    FLASK_SECRET_KEY,
    FRONTEND_DIST_DIR,
    TEMPLATES_DIR,
    STATIC_DIR,
    is_debug_enabled,
)
from src.core.db import init_db
from src.core.runtime import RuntimeState


def get_frontend_dist_dir() -> str:
    return str(FRONTEND_DIST_DIR)


def add_csp_headers_factory(app: Flask) -> Callable:
    cdn_hosts = CSP_CDN_HOSTS

    def add_csp_headers(response):
        if app.debug:
            response.headers['Content-Security-Policy'] = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-eval' " + cdn_hosts + "; "
                "connect-src 'self' ws: wss: " + cdn_hosts + "; "
                "img-src 'self' data:; style-src 'self' 'unsafe-inline'"
            )
        else:
            response.headers['Content-Security-Policy'] = (
                "default-src 'self'; "
                "script-src 'self' " + cdn_hosts + "; "
                "connect-src 'self' ws: wss: " + cdn_hosts + "; "
                "img-src 'self' data:; style-src 'self' 'unsafe-inline'"
            )
        return response

    return add_csp_headers


def register_extensions(app: Flask) -> None:
    socketio = SocketIO(app, cors_allowed_origins="*")
    app.extensions['socketio'] = socketio
    app.extensions['runtime_state'] = RuntimeState()


def register_blueprints(app: Flask) -> None:
    from src.api.locks import locks_bp
    from src.api.devices import devices_bp
    from src.api.ingest import ingest_bp
    from src.api.counting import counting_bp
    from src.api.inventory import inventory_bp

    app.register_blueprint(locks_bp)
    app.register_blueprint(devices_bp)
    app.register_blueprint(ingest_bp)
    app.register_blueprint(counting_bp)
    app.register_blueprint(inventory_bp)


def register_frontend_routes(app: Flask) -> None:
    @app.route("/")
    def home():
        dist_dir = get_frontend_dist_dir()
        index_file = os.path.join(dist_dir, 'index.html')
        if os.path.exists(index_file):
            return send_from_directory(dist_dir, 'index.html')
        return render_template("base.html")

    @app.route('/<path:path>')
    def frontend_static(path):
        dist_dir = get_frontend_dist_dir()
        target = os.path.join(dist_dir, path)
        if os.path.exists(target):
            return send_from_directory(dist_dir, path)
        return ('Not Found', 404)


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder=str(TEMPLATES_DIR),
        static_folder=str(STATIC_DIR)
    )
    app.secret_key = FLASK_SECRET_KEY

    register_extensions(app)

    app.after_request(add_csp_headers_factory(app))
    register_blueprints(app)
    register_frontend_routes(app)

    init_db()
    # Clear stale counting state left from previous crashes if no process exists
    try:
        from src.api import counting as _counting
        try:
            _counting.startup_clear_stale_state()
        except Exception:
            pass
    except Exception:
        pass
    return app


app = create_app()
socketio = app.extensions['socketio']


if __name__ == "__main__":
    socketio.run(app, host=APP_HOST, port=APP_PORT, debug=is_debug_enabled())
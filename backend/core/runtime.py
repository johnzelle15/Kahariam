from dataclasses import dataclass
from subprocess import Popen
from typing import Optional

from flask import current_app


@dataclass
class RuntimeState:
    process: Optional[Popen] = None
    fish_count: int = 0
    counting_active: bool = False


def get_runtime() -> RuntimeState:
    runtime = current_app.extensions.get('runtime_state')
    if runtime is None:
        raise RuntimeError('runtime_state is not initialized')
    return runtime


def get_socketio():
    socketio = current_app.extensions.get('socketio')
    if socketio is None:
        raise RuntimeError('socketio is not initialized')
    return socketio

from flask import Blueprint, jsonify, request
import subprocess
import sys
import os
import signal
from pathlib import Path
from backend.core.db import get_db
from datetime import datetime
from backend.core.runtime import get_runtime, get_socketio
from backend.api.auth_otp import require_auth

counting_bp = Blueprint('counting', __name__)
COUNTER_PID_FILE = Path(__file__).resolve().parent.parent.parent / 'runtime' / 'fish_counter.pid'


def _build_counter_env() -> dict:
    env = os.environ.copy()

    # Re-read .env so we always pick up the latest SHOW_PREVIEW_WINDOW value,
    # even if the Flask process was started before the .env was edited.
    try:
        dotenv_path = Path(__file__).resolve().parent.parent.parent / '.env'
        if dotenv_path.is_file():
            for line in dotenv_path.read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    key, _, val = line.partition('=')
                    env[key.strip()] = val.strip()
    except Exception:
        pass

    show_preview = env.get('SHOW_PREVIEW_WINDOW', '').strip().lower() in {'1', 'true', 'yes', 'on'}
    if not show_preview:
        return env

    # Always inject DISPLAY and XAUTHORITY so the preview appears on the
    # RPi5's local screen, no matter which device triggered start counting.
    env['DISPLAY'] = env.get('PREVIEW_DISPLAY', ':0')

    if not env.get('XAUTHORITY'):
        default_xauthority = str(Path.home() / '.Xauthority')
        env['XAUTHORITY'] = env.get('PREVIEW_XAUTHORITY', default_xauthority)

    return env


def _write_counter_pid(pid: int) -> None:
    try:
        COUNTER_PID_FILE.parent.mkdir(parents=True, exist_ok=True)
        COUNTER_PID_FILE.write_text(str(int(pid)), encoding='utf-8')
    except Exception:
        pass


def _read_counter_pid() -> int:
    try:
        raw = COUNTER_PID_FILE.read_text(encoding='utf-8').strip()
        return int(raw)
    except Exception:
        return 0


def _clear_counter_pid() -> None:
    try:
        if COUNTER_PID_FILE.exists():
            COUNTER_PID_FILE.unlink()
    except Exception:
        pass


def _force_kill_pid(pid: int) -> None:
    if pid <= 0:
        return
    try:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            os.kill(pid, signal.SIGTERM)
    except Exception:
        pass


def _is_pid_running(pid: int) -> bool:
    """Best-effort check whether pid is running on this host."""
    if not pid or pid <= 0:
        return False
    try:
        if os.name == 'nt':
            # Use tasklist to check for PID on Windows
            try:
                out = subprocess.run(['tasklist', '/FI', f'PID eq {pid}'], capture_output=True, text=True)
                return str(pid) in out.stdout
            except Exception:
                return False
        else:
            # POSIX: sending signal 0 checks existence
            os.kill(pid, 0)
            return True
    except Exception:
        return False


def _kill_processes_by_name(name_pattern: str) -> int:
    """Best-effort: find processes whose command-line includes name_pattern and kill them.

    Returns number of PIDs killed.
    """
    killed = 0
    try:
        if os.name == 'nt':
            # Try wmic to find ProcessId by commandline
            try:
                out = subprocess.run(['wmic', 'process', 'where', f"CommandLine like '%{name_pattern}%'", 'get', 'ProcessId'], capture_output=True, text=True)
                lines = [l.strip() for l in out.stdout.splitlines() if l.strip() and l.strip() != 'ProcessId']
                for l in lines:
                    try:
                        pid = int(l)
                        _force_kill_pid(pid)
                        killed += 1
                    except Exception:
                        continue
                return killed
            except Exception:
                pass
            # Fallback: use tasklist and findstr (less reliable)
            try:
                out = subprocess.run(['tasklist', '/v', '/fo', 'csv'], capture_output=True, text=True)
                for line in out.stdout.splitlines():
                    if name_pattern in line:
                        parts = [p.strip('"') for p in line.split(',')]
                        if len(parts) > 1:
                            try:
                                pid = int(parts[1])
                                _force_kill_pid(pid)
                                killed += 1
                            except Exception:
                                continue
            except Exception:
                pass
        else:
            # POSIX: use pgrep -f
            try:
                out = subprocess.run(['pgrep', '-f', name_pattern], capture_output=True, text=True)
                for l in out.stdout.splitlines():
                    try:
                        pid = int(l.strip())
                        _force_kill_pid(pid)
                        killed += 1
                    except Exception:
                        continue
            except Exception:
                pass
    except Exception:
        pass
    return killed


def startup_clear_stale_state():
    """Check counting_state on app start and clear if PID/process is not running.

    This is best-effort: it will clear the DB flag when no detector process exists
    to avoid leaving the UI locked on crashed/stale runs.
    """
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT active FROM counting_state WHERE id=1')
        row = c.fetchone()
        active = bool(row['active'] if isinstance(row, dict) else row[0]) if row else False
        if not active:
            conn.close()
            return

        pid = _read_counter_pid()
        running = False
        try:
            if pid and _is_pid_running(pid):
                running = True
        except Exception:
            running = False

        if not running:
            now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            try:
                c.execute('UPDATE counting_state SET active=0, updated_at=? WHERE id=1', (now_str,))
                conn.commit()
            finally:
                conn.close()
            try:
                # notify connected clients (if socketio available)
                socketio = get_socketio()
                try:
                    socketio.emit('counting_state', {'active': False})
                except Exception:
                    pass
            except Exception:
                pass
        else:
            conn.close()
    except Exception:
        # Do not raise on startup
        try:
            conn.close()
        except Exception:
            pass


@counting_bp.route('/start')
@require_auth
def start():
    runtime = get_runtime()
    socketio = get_socketio()
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute('SELECT active FROM counting_state WHERE id=1 FOR UPDATE')
        row = c.fetchone()
        if row and row['active']:
            # Check if a process is actually running. If not, treat DB state as stale and reset it.
            pid_from_file = _read_counter_pid()
            running = False
            try:
                if runtime.process is not None and runtime.process.poll() is None:
                    running = True
                elif pid_from_file and _is_pid_running(pid_from_file):
                    running = True
            except Exception:
                running = False

            if running:
                conn.rollback()
                conn.close()
                return jsonify({"status": "error", "message": "Counting already in progress!"}), 409

            # Stale: clear DB flag and continue to start a fresh process
            try:
                now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                c.execute('UPDATE counting_state SET active=0, updated_at=? WHERE id=1', (now_str,))
                conn.commit()
                # broadcast reset so UIs update
                try:
                    socketio.emit('counting_state', {'active': False})
                except Exception:
                    pass
            except Exception:
                conn.rollback()
                conn.close()
                return jsonify({"status": "error", "message": "DB error while clearing stale state"}), 500

        if runtime.process is None or runtime.process.poll() is not None:
            runtime.fish_count = 0
            # vision/fish_counter.py lives at project_root/vision/
            project_root = Path(__file__).resolve().parent.parent.parent
            counter_script = project_root / 'vision' / 'fish_counter.py'
            runtime.process = subprocess.Popen([sys.executable, str(counter_script)], env=_build_counter_env())
            _write_counter_pid(runtime.process.pid)
            runtime.counting_active = True
            # Set counting_state to active
            c.execute('UPDATE counting_state SET active=1, updated_at=? WHERE id=1', (datetime.now().strftime('%Y-%m-%d %H:%M:%S'),))
            conn.commit()
            conn.close()
            _open_session(getattr(request, 'user', None), request.args.get('variant', ''))
            # Broadcast to ALL connected clients that counting started
            try:
                socketio.emit('counting_state', {'active': True})
            except Exception as e:
                print(f"Warning: could not broadcast start event: {e}")
            return jsonify({"status": "ok", "message": "Fish Counter Started!"})
        else:
            conn.rollback()
            conn.close()
            return jsonify({"status": "error", "message": "Already Running!"}), 409
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({"status": "error", "message": f"DB error: {e}"}), 500


@counting_bp.route('/stop')
@require_auth
def stop():
    runtime = get_runtime()
    socketio = get_socketio()

    stopped = False

    if runtime.process is not None and runtime.process.poll() is None:
        runtime.process.terminate()
        try:
            runtime.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            runtime.process.kill()
        stopped = True

    if runtime.process is not None and runtime.process.poll() is None:
        try:
            _force_kill_pid(runtime.process.pid)
            stopped = True
        except Exception:
            pass

    if not stopped:
        pid_from_file = _read_counter_pid()
        if pid_from_file > 0:
            _force_kill_pid(pid_from_file)
            stopped = True

    # If still not stopped, try to find any processes running the script by name
    if not stopped:
        killed = _kill_processes_by_name('fish_counter.py')
        if killed > 0:
            stopped = True

    runtime.process = None
    _clear_counter_pid()
    runtime.counting_active = False

    # Set counting_state to inactive
    conn = get_db()
    c = conn.cursor()
    c.execute('UPDATE counting_state SET active=0, updated_at=? WHERE id=1', (datetime.now().strftime('%Y-%m-%d %H:%M:%S'),))
    conn.commit()
    conn.close()

    _close_session(runtime.fish_count)

    # Broadcast to ALL connected clients that counting stopped
    try:
        socketio.emit('counting_state', {'active': False})
    except Exception as e:
        print(f"Warning: could not broadcast stop event: {e}")

    if stopped:
        return jsonify({"status": "ok", "message": "Fish Counter Stopped!"})
    return jsonify({"status": "error", "message": "Not Running!"}), 409


@counting_bp.route('/get_count')
@require_auth
def get_count():
    runtime = get_runtime()
    return jsonify({"count": runtime.fish_count})


@counting_bp.route('/get_state')
@require_auth
def get_state():
    """Read counting state from DATABASE (not in-memory) for multi-device sync."""
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT active FROM counting_state WHERE id=1')
        row = c.fetchone()
        active = bool(row['active'] if isinstance(row, dict) else row[0]) if row else False
        conn.close()
        device_id = counter_device_id()
        return jsonify({
            "active": active,
            "device_id": device_id,
            "device_name": _device_name(device_id),
            "session": get_active_session() if active else None,
        })
    except Exception:
        # Fallback to runtime if DB fails
        runtime = get_runtime()
        return jsonify({"active": runtime.counting_active})


@counting_bp.route('/update_count', methods=['POST'])
@require_auth
def update_count():
    runtime = get_runtime()
    data = request.get_json()
    runtime.fish_count = data.get("count", 0)
    return jsonify({"status": "success"})


# ── Counting sessions ────────────────────────────────────────────────────────
# A counting run is a record: who ran it, on which device, for how long, and
# whether it ever reached inventory. Previously this lived only in
# counting_state (one row, no history), so nothing could be reviewed after
# the fact.

def counter_device_id():
    """The device the local counter process reports as.

    vision/fish_counter.py posts readings under DEVICE_ID, so that is the
    device a counting session actually occupies — the UI used to lock a
    hardcoded 'test-device' instead, which is a different row entirely.
    """
    return (os.environ.get('DEVICE_ID') or '').strip() or None


def _device_name(device_id):
    if not device_id:
        return None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT name FROM devices WHERE id = ?', (device_id,))
        row = c.fetchone()
        conn.close()
        if not row:
            return None
        return (row['name'] if isinstance(row, dict) else row[0]) or None
    except Exception:
        return None


def _open_session(user, variant):
    """Record the start of a run. Never raises — a bookkeeping failure must
    not stop the operator from counting fish."""
    try:
        conn = get_db()
        c = conn.cursor()
        # Any session still marked active is stale (crash, power cut); close it
        # rather than leaving two runs open at once.
        c.execute("UPDATE counting_sessions SET status='aborted', ended_at=? "
                  "WHERE status='active'",
                  (datetime.now().strftime('%Y-%m-%d %H:%M:%S'),))
        c.execute(
            'INSERT INTO counting_sessions '
            '(device_id, user_id, username, variant, started_at, status) '
            "VALUES (?, ?, ?, ?, ?, 'active')",
            (counter_device_id(),
             (user or {}).get('sub'),
             (user or {}).get('username'),
             (variant or '').strip() or None,
             datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[WARN] could not open counting session: {e}")


def _close_session(final_count):
    """Close the open run. 'completed' when fish were counted, 'aborted' when
    the run produced nothing — the two mean different things to a supervisor."""
    try:
        status = 'completed' if int(final_count or 0) > 0 else 'aborted'
        conn = get_db()
        c = conn.cursor()
        c.execute(
            'UPDATE counting_sessions SET ended_at=?, final_count=?, status=? '
            "WHERE status='active'",
            (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), int(final_count or 0), status)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[WARN] could not close counting session: {e}")


def get_active_session():
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT id, username, variant, started_at, device_id "
                  "FROM counting_sessions WHERE status='active' "
                  'ORDER BY id DESC LIMIT 1')
        row = c.fetchone()
        conn.close()
        if not row:
            return None
        started = row['started_at']
        return {
            'id': row['id'],
            'username': row['username'],
            'variant': row['variant'],
            'device_id': row['device_id'],
            'started_at': started.strftime('%Y-%m-%d %H:%M:%S') if hasattr(started, 'strftime') else str(started),
        }
    except Exception:
        return None


@counting_bp.route('/api/sessions')
@require_auth
def list_sessions():
    try:
        limit = max(1, min(50, int(request.args.get('limit', 10))))
    except ValueError:
        limit = 10
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT id, username, variant, started_at, ended_at, final_count, status, device_id '
              'FROM counting_sessions ORDER BY id DESC LIMIT ' + str(limit))
    out = []
    for row in c.fetchall():
        def fmt(v):
            return v.strftime('%Y-%m-%d %H:%M:%S') if hasattr(v, 'strftime') else (str(v) if v else None)
        out.append({
            'id': row['id'],
            'username': row['username'],
            'variant': row['variant'],
            'started_at': fmt(row['started_at']),
            'ended_at': fmt(row['ended_at']),
            'final_count': row['final_count'],
            'status': row['status'],
            'device_id': row['device_id'],
        })
    conn.close()
    return jsonify({'sessions': out})

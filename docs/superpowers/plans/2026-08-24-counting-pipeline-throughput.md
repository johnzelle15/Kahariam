# Counting Pipeline Throughput & Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the fish-counting detection loop from blocking on network/database I/O per individual fish, and add database connection pooling — both needed at the client's real throughput of 500k-1M fish/week.

**Architecture:** Two independent tasks. Task 1 extracts a small, unit-testable `CountReporter` class (`vision/count_reporter.py`) that runs on a background daemon thread and periodically sends the vision loop's current cumulative count, then wires it into `vision/fish_counter.py` in place of the per-fish blocking `post_count()` calls, plus a graceful-SIGTERM final flush. Task 2 adds a thread-safe, lazily-created MariaDB connection pool inside `backend/core/db.py`, changing only `get_db()`'s internals — every existing caller across the app is untouched.

**Tech Stack:** Python 3, `mariadb` connector (v1.1.14, already installed, native `ConnectionPool` support confirmed), stdlib `threading`/`signal`/`unittest` (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-08-24-counting-pipeline-throughput-design.md`

## Global Constraints

- No new pip dependencies. No backend API/route signature changes. No change to detection/tracking logic (YOLO, Kalman tracker) or to `inventory.py`/`/save_inventory`.
- The background reporter sends the **current cumulative total** on every send (never a delta) — this is what makes a failed/skipped send self-healing on the next tick, per the spec's Error Handling section.
- `post_count` (the actual HTTP call) must never raise out of its own function — it already catches its own exceptions today; this behavior is preserved, just with the broken legacy-fallback branch removed.
- `INGEST_INTERVAL_SECONDS` default `1.0` (matches the Counter screen's existing 1-second poll fallback, so live-count UX is unchanged).
- `DB_POOL_SIZE` default `10`.
- No test framework is installed in this repo (confirmed: no `pytest`, `tests/` holds only empty `__init__.py` stubs) — tests use stdlib `unittest`, run via `python3 -m unittest`.

---

### Task 1: Background count reporter + graceful shutdown (vision side)

**Files:**
- Create: `vision/count_reporter.py`
- Create: `tests/test_vision/test_count_reporter.py`
- Modify: `vision/fish_counter.py` (imports, env var, `post_count_with_urllib`/`post_count_with_requests`, `run_counter`, the two crossing-detection blocks)
- Modify: `backend/core/config.py` (remove now-unused `LEGACY_UPDATE_COUNT_URL`)

**Interfaces:**
- Consumes: nothing from Task 2 (fully independent).
- Produces: `CountReporter(get_count: Callable[[], int], post_count: Callable[[int], None], interval_seconds: float)` with `.start()` and `.stop_and_flush()` methods — a fresh instance per counting session, created and used entirely inside `run_counter()`.

- [ ] **Step 1: Write the failing tests for `CountReporter`**

Create `tests/test_vision/test_count_reporter.py`:

```python
import time
import unittest

from vision.count_reporter import CountReporter


class FakePoster:
    """Records calls; can be told to raise on the first N calls."""

    def __init__(self, fail_first_n=0):
        self.calls = []
        self._fail_remaining = fail_first_n

    def __call__(self, count):
        if self._fail_remaining > 0:
            self._fail_remaining -= 1
            raise RuntimeError("simulated post failure")
        self.calls.append(count)


class CountReporterTest(unittest.TestCase):
    def test_sends_roughly_once_per_interval_not_per_increment(self):
        count_holder = {'value': 0}
        poster = FakePoster()
        reporter = CountReporter(
            get_count=lambda: count_holder['value'],
            post_count=poster,
            interval_seconds=0.05,
        )
        reporter.start()
        for i in range(1, 21):
            count_holder['value'] = i
            time.sleep(0.005)  # 20 increments over ~0.1s; interval is 0.05s
        time.sleep(0.1)
        reporter.stop_and_flush()

        self.assertLess(len(poster.calls), 20)
        self.assertEqual(poster.calls[-1], 20)

    def test_never_sends_a_stale_lower_value_than_before_it(self):
        count_holder = {'value': 0}
        poster = FakePoster()
        reporter = CountReporter(
            get_count=lambda: count_holder['value'],
            post_count=poster,
            interval_seconds=0.02,
        )
        reporter.start()
        for i in range(1, 6):
            count_holder['value'] = i
            time.sleep(0.03)
        reporter.stop_and_flush()

        self.assertEqual(sorted(poster.calls), poster.calls)

    def test_stop_and_flush_sends_exactly_one_final_update(self):
        count_holder = {'value': 0}
        poster = FakePoster()
        reporter = CountReporter(
            get_count=lambda: count_holder['value'],
            post_count=poster,
            interval_seconds=10.0,  # long enough that no periodic tick fires
        )
        reporter.start()
        count_holder['value'] = 7
        reporter.stop_and_flush()

        self.assertEqual(poster.calls, [7])

    def test_survives_a_post_failure_and_keeps_reporting(self):
        count_holder = {'value': 1}
        poster = FakePoster(fail_first_n=1)
        reporter = CountReporter(
            get_count=lambda: count_holder['value'],
            post_count=poster,
            interval_seconds=0.02,
        )
        reporter.start()
        time.sleep(0.05)  # first tick(s) hit the simulated failure
        count_holder['value'] = 2
        time.sleep(0.05)  # later tick should succeed
        reporter.stop_and_flush()

        self.assertIn(2, poster.calls)

    def test_no_send_when_count_never_changes(self):
        poster = FakePoster()
        reporter = CountReporter(
            get_count=lambda: 0,
            post_count=poster,
            interval_seconds=0.02,
        )
        reporter.start()
        time.sleep(0.05)
        reporter.stop_and_flush()

        self.assertEqual(poster.calls, [])


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/aquaculture/Fish-Counter && PYTHONPATH=. .venv/bin/python -m unittest tests.test_vision.test_count_reporter -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'vision.count_reporter'`

- [ ] **Step 3: Create `vision/count_reporter.py`**

```python
"""Background periodic reporter for the fish-counting pipeline.

Runs a fixed-interval loop on a daemon thread that sends the caller's
current cumulative count via a supplied `post_count` function, only when
the count has changed since the last successful send. Because each send
carries the full running total (never a delta), a failed or skipped send
self-heals on the next tick -- no retry queue or delta bookkeeping needed.
"""
import threading
from typing import Callable, Optional


class CountReporter:
    def __init__(
        self,
        get_count: Callable[[], int],
        post_count: Callable[[int], None],
        interval_seconds: float,
    ) -> None:
        self._get_count = get_count
        self._post_count = post_count
        self._interval_seconds = interval_seconds
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._last_sent = 0

    def start(self) -> None:
        """Start the background sender. Call once per session."""
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop_event.wait(self._interval_seconds):
            try:
                self._send_if_changed()
            except Exception as exc:
                print(f"[WARN] CountReporter failed to send: {exc}")

    def _send_if_changed(self) -> None:
        count = self._get_count()
        if count != self._last_sent:
            self._post_count(count)
            self._last_sent = count

    def stop_and_flush(self) -> None:
        """Stop the background loop and guarantee one final, up-to-date send."""
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=self._interval_seconds + 1)
        try:
            self._send_if_changed()
        except Exception as exc:
            print(f"[WARN] CountReporter final flush failed: {exc}")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/aquaculture/Fish-Counter && PYTHONPATH=. .venv/bin/python -m unittest tests.test_vision.test_count_reporter -v`
Expected: `OK` (5 tests)

- [ ] **Step 5: Commit**

```bash
git add vision/count_reporter.py tests/test_vision/test_count_reporter.py
git commit -m "feat: add CountReporter for batched background count sending"
```

- [ ] **Step 6: Wire `CountReporter` into `vision/fish_counter.py` — imports**

In `vision/fish_counter.py`, change:

```python
import json
import os
import sys
import time
import urllib.request
from dataclasses import dataclass
```

to:

```python
import json
import os
import signal
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass
```

Then change:

```python
from backend.core.config import INGEST_URL, LEGACY_UPDATE_COUNT_URL
from vision.tracker import CentroidTracker, TrackedObject
from vision.kalman_tracker import KalmanSortTracker
```

to:

```python
from backend.core.config import INGEST_URL
from vision.count_reporter import CountReporter
from vision.tracker import CentroidTracker, TrackedObject
from vision.kalman_tracker import KalmanSortTracker
```

- [ ] **Step 7: Add the `INGEST_INTERVAL_SECONDS` env var**

Find this line (in the block of `env_int`/`env_float` constants):

```python
MIN_CROSSING_FRAMES = env_int('MIN_CROSSING_FRAMES', 12, minimum=1, maximum=120)
```

Add immediately after it:

```python
MIN_CROSSING_FRAMES = env_int('MIN_CROSSING_FRAMES', 12, minimum=1, maximum=120)

# ─────────────────────────────────────────────────────────────────────────────
# Ingest Reporting
# ─────────────────────────────────────────────────────────────────────────────
# How often the background reporter sends the latest cumulative count to the
# backend. Matches the Counter screen's existing 1s poll fallback so the
# live count still feels immediate, while fully decoupling the detection
# loop from network/database latency.
INGEST_INTERVAL_SECONDS = env_float('INGEST_INTERVAL_SECONDS', 1.0, minimum=0.1, maximum=10.0)
```

- [ ] **Step 8: Simplify `post_count_with_urllib` and `post_count_with_requests` — remove the broken legacy fallback**

In `vision/fish_counter.py`, find this exact block (note: `build_request_payload`, immediately above it, is NOT part of this replacement and stays untouched):

```python
def post_count_with_urllib(count: int) -> None:
    ingest_url = os.environ.get('INGEST_URL', INGEST_URL)
    token = os.environ.get('DEVICE_TOKEN')
    payload = build_request_payload(count)
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'

    try:
        req = urllib.request.Request(
            ingest_url,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception:
        try:
            fallback_req = urllib.request.Request(
                LEGACY_UPDATE_COUNT_URL,
                data=json.dumps({'count': count}).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
            )
            urllib.request.urlopen(fallback_req, timeout=1)
        except Exception as exc:
            print(f"[WARN] Failed to post count (urllib): {exc}")


def build_post_count_handler():
    try:
        import requests
    except Exception:
        return post_count_with_urllib

    def post_count_with_requests(count: int) -> None:
        ingest_url = os.environ.get('INGEST_URL', INGEST_URL)
        token = os.environ.get('DEVICE_TOKEN')
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        payload = build_request_payload(count)

        try:
            response = requests.post(ingest_url, json=payload, headers=headers, timeout=2)
            if not (200 <= getattr(response, 'status_code', 0) < 300):
                requests.post(LEGACY_UPDATE_COUNT_URL, json={'count': count}, timeout=1)
        except Exception:
            try:
                requests.post(LEGACY_UPDATE_COUNT_URL, json={'count': count}, timeout=1)
            except Exception as exc:
                print(f"[WARN] Failed to post count: {exc}")

    return post_count_with_requests
```

Replace that whole block with:

```python
def post_count_with_urllib(count: int) -> None:
    ingest_url = os.environ.get('INGEST_URL', INGEST_URL)
    token = os.environ.get('DEVICE_TOKEN')
    payload = build_request_payload(count)
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'

    try:
        req = urllib.request.Request(
            ingest_url,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception as exc:
        print(f"[WARN] Failed to post count (urllib): {exc}")


def build_post_count_handler():
    try:
        import requests
    except Exception:
        return post_count_with_urllib

    def post_count_with_requests(count: int) -> None:
        ingest_url = os.environ.get('INGEST_URL', INGEST_URL)
        token = os.environ.get('DEVICE_TOKEN')
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        payload = build_request_payload(count)

        try:
            response = requests.post(ingest_url, json=payload, headers=headers, timeout=2)
            if not (200 <= getattr(response, 'status_code', 0) < 300):
                print(f"[WARN] Ingest responded with status {getattr(response, 'status_code', '?')}")
        except Exception as exc:
            print(f"[WARN] Failed to post count: {exc}")

    return post_count_with_requests
```

(`build_request_payload`, immediately above this block, is unchanged — leave it exactly as-is.)

- [ ] **Step 9: Add the SIGTERM shutdown event and handler**

Immediately before `def run_counter(post_count) -> None:`, add:

```python
_shutdown_requested = threading.Event()


def _handle_sigterm(signum, frame):
    _shutdown_requested.set()


def run_counter(post_count) -> None:
```

- [ ] **Step 10: Register the handler and reset the event at the top of `run_counter`**

Find, near the top of `run_counter`'s body:

```python
    global INPUT_SIZE

    print("=" * 60)
    print("  FISH COUNTER - Optimized for Raspberry Pi 5")
```

Change to:

```python
    global INPUT_SIZE

    _shutdown_requested.clear()
    signal.signal(signal.SIGTERM, _handle_sigterm)

    print("=" * 60)
    print("  FISH COUNTER - Optimized for Raspberry Pi 5")
```

- [ ] **Step 11: Start the reporter after the state variables are declared**

Find:

```python
    counter = 0                 # Total fish count
    counter_up = 0              # Fish moving up (if bidirectional)
    counter_down = 0            # Fish moving down
    class_counts = {name: 0 for name in CLASS_NAMES}  # Per-class fish count
    frame_index = 0             # Frame counter
    recently_counted_ids = {}   # {track_id: frame_when_counted} for visualization
    
    # FPS calculation
```

Change to:

```python
    counter = 0                 # Total fish count
    counter_up = 0              # Fish moving up (if bidirectional)
    counter_down = 0            # Fish moving down
    class_counts = {name: 0 for name in CLASS_NAMES}  # Per-class fish count
    frame_index = 0             # Frame counter
    recently_counted_ids = {}   # {track_id: frame_when_counted} for visualization

    # Background reporter: sends the latest cumulative count on its own
    # schedule so the detection loop never blocks on network/database I/O.
    # ponytail: relies on GIL-safe reads of `counter` across threads (a
    # plain int rebind); add a Lock if counter ever becomes compound state.
    reporter = CountReporter(
        get_count=lambda: counter,
        post_count=post_count,
        interval_seconds=INGEST_INTERVAL_SECONDS,
    )
    reporter.start()

    # FPS calculation
```

- [ ] **Step 12: Make the main loop check the shutdown event**

Find:

```python
    while True:
        ret, frame = capture.read()
```

Change to:

```python
    while not _shutdown_requested.is_set():
        ret, frame = capture.read()
```

- [ ] **Step 13: Remove the two blocking `post_count` calls from the crossing-detection blocks**

Find:

```python
            for obj in down_crossings:
                counter += 1
                counter_down += 1
                cls_name = CLASS_NAMES[obj.class_id] if obj.class_id < len(CLASS_NAMES) else 'Unknown'
                class_counts[cls_name] = class_counts.get(cls_name, 0) + 1
                tracker.mark_counted(obj, frame_index)
                recently_counted_ids[obj.object_id] = frame_index
                
                print(f"[COUNT] {cls_name} #{counter} crossed DOWN (Track ID: {obj.object_id})")
                
                try:
                    post_count(counter)
                except Exception as exc:
                    print(f"[WARN] Failed to post count: {exc}")
```

Change to:

```python
            for obj in down_crossings:
                counter += 1
                counter_down += 1
                cls_name = CLASS_NAMES[obj.class_id] if obj.class_id < len(CLASS_NAMES) else 'Unknown'
                class_counts[cls_name] = class_counts.get(cls_name, 0) + 1
                tracker.mark_counted(obj, frame_index)
                recently_counted_ids[obj.object_id] = frame_index
                
                print(f"[COUNT] {cls_name} #{counter} crossed DOWN (Track ID: {obj.object_id})")
```

Then find:

```python
            for obj in up_crossings:
                cls_name = CLASS_NAMES[obj.class_id] if obj.class_id < len(CLASS_NAMES) else 'Unknown'
                if COUNTING_DIRECTION == 'both':
                    counter_up += 1
                else:
                    counter += 1
                class_counts[cls_name] = class_counts.get(cls_name, 0) + 1
                tracker.mark_counted(obj, frame_index)
                recently_counted_ids[obj.object_id] = frame_index
                
                print(f"[COUNT] {cls_name} crossed UP (Track ID: {obj.object_id})")
                
                try:
                    post_count(counter)
                except Exception as exc:
                    print(f"[WARN] Failed to post count: {exc}")
```

Change to:

```python
            for obj in up_crossings:
                cls_name = CLASS_NAMES[obj.class_id] if obj.class_id < len(CLASS_NAMES) else 'Unknown'
                if COUNTING_DIRECTION == 'both':
                    counter_up += 1
                else:
                    counter += 1
                class_counts[cls_name] = class_counts.get(cls_name, 0) + 1
                tracker.mark_counted(obj, frame_index)
                recently_counted_ids[obj.object_id] = frame_index
                
                print(f"[COUNT] {cls_name} crossed UP (Track ID: {obj.object_id})")
```

- [ ] **Step 14: Flush the reporter during cleanup**

Find:

```python
    # ─────────────────────────────────────────────────────────────────────────
    # Cleanup
    # ─────────────────────────────────────────────────────────────────────────
    capture.release()
    if SHOW_PREVIEW_WINDOW:
        cv2.destroyAllWindows()
    
    print("-" * 60)
    print(f"[DONE] Final count: {counter}")
```

Change to:

```python
    # ─────────────────────────────────────────────────────────────────────────
    # Cleanup
    # ─────────────────────────────────────────────────────────────────────────
    capture.release()
    if SHOW_PREVIEW_WINDOW:
        cv2.destroyAllWindows()

    # Stop the background reporter and guarantee the final count reaches the
    # backend even if it changed between the last periodic tick and now.
    reporter.stop_and_flush()

    print("-" * 60)
    print(f"[DONE] Final count: {counter}")
```

- [ ] **Step 15: Remove the now-unused `LEGACY_UPDATE_COUNT_URL` from `backend/core/config.py`**

In `backend/core/config.py`, change:

```python
INGEST_URL = os.environ.get('INGEST_URL', 'http://127.0.0.1:5000/api/v1/ingest')
LEGACY_UPDATE_COUNT_URL = os.environ.get('LEGACY_UPDATE_COUNT_URL', 'http://127.0.0.1:5000/update_count')
```

to:

```python
INGEST_URL = os.environ.get('INGEST_URL', 'http://127.0.0.1:5000/api/v1/ingest')
```

- [ ] **Step 16: Compile-check**

Run: `cd /home/aquaculture/Fish-Counter && python3 -m py_compile vision/fish_counter.py vision/count_reporter.py backend/core/config.py`
Expected: no output, exit code 0.

- [ ] **Step 17: Re-run the `CountReporter` tests (confirm nothing broke) and commit**

Run: `cd /home/aquaculture/Fish-Counter && PYTHONPATH=. .venv/bin/python -m unittest tests.test_vision.test_count_reporter -v`
Expected: `OK` (5 tests)

```bash
git add vision/fish_counter.py backend/core/config.py
git commit -m "feat: batch fish-count reporting off the detection loop, add graceful shutdown"
```

---

### Task 2: MariaDB connection pooling

**Files:**
- Modify: `backend/core/db.py` (`get_db()` and its imports)
- Create: `tests/test_api/test_db_pool.py`

**Interfaces:**
- Consumes: nothing from Task 1 (fully independent).
- Produces: no change to `get_db()`'s public contract — still returns a `MariaDBConnectionWrapper` with `.cursor()`/`.commit()`/`.rollback()`/`.close()`, used identically by every existing caller across the app. Adds module-level `db._pool` (a `mariadb.ConnectionPool` or `None` before first use) and `db._get_pool()`, for the test to introspect.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_api/test_db_pool.py`:

```python
import threading
import unittest

from backend.core import db


class DbPoolTest(unittest.TestCase):
    def setUp(self):
        # Force a fresh pool per test so tests don't depend on each other's
        # module-level state or on test execution order.
        db._pool = None

    def test_get_db_returns_a_working_connection_repeatedly(self):
        # More calls than the default pool_size (10), to exercise reuse.
        for _ in range(15):
            conn = db.get_db()
            cur = conn.cursor()
            cur.execute('SELECT 1')
            row = cur.fetchone()
            self.assertIsNotNone(row)
            conn.close()

    def test_pool_is_constructed_exactly_once_under_concurrent_calls(self):
        pool_ids = []
        lock = threading.Lock()

        def worker():
            conn = db.get_db()
            with lock:
                pool_ids.append(id(db._pool))
            conn.close()

        threads = [threading.Thread(target=worker) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(pool_ids), 20)
        self.assertEqual(len(set(pool_ids)), 1)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/aquaculture/Fish-Counter && PYTHONPATH=. .venv/bin/python -m unittest tests.test_api.test_db_pool -v`
Expected: FAIL — `setUp` raises `AttributeError: module 'backend.core.db' has no attribute '_pool'` (both tests error out) since `db._pool` doesn't exist yet.

- [ ] **Step 3: Add the connection pool to `backend/core/db.py`**

Change:

```python
import os
from datetime import datetime
import bcrypt
from pathlib import Path

# MariaDB-only mode
DB_ENGINE = 'mariadb'
```

to:

```python
import os
import threading
from datetime import datetime
import bcrypt
from pathlib import Path

# MariaDB-only mode
DB_ENGINE = 'mariadb'

_pool = None
_pool_lock = threading.Lock()


def _get_pool():
    """Lazily create the module-level MariaDB connection pool (thread-safe)."""
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is None:
            import mariadb
            host = os.environ.get('DB_HOST', 'localhost')
            user = os.environ.get('DB_USER', 'fishuser')
            password = os.environ.get('DB_PASSWORD', '')
            dbname = os.environ.get('DB_NAME', 'inventory')
            port = int(os.environ.get('DB_PORT', 3306))
            pool_size = int(os.environ.get('DB_POOL_SIZE', 10))
            _pool = mariadb.ConnectionPool(
                pool_name='fishcounter_pool',
                pool_size=pool_size,
                host=host,
                user=user,
                password=password,
                database=dbname,
                port=port,
            )
        return _pool
```

- [ ] **Step 4: Change `get_db()` to use the pool**

Change:

```python
def get_db():
    """Return a MariaDB DB-API connection wrapper.

    Uses `mariadb` connector when available, with `pymysql` fallback.
    """
    use_mariadb = False
    try:
        import mariadb
        use_mariadb = True
    except Exception:
        try:
            import pymysql
            from pymysql.cursors import DictCursor
        except Exception as e:
            raise RuntimeError('MariaDB driver required: pip install mariadb (or pymysql)') from e

    host = os.environ.get('DB_HOST', 'localhost')
    user = os.environ.get('DB_USER', 'fishuser')
    password = os.environ.get('DB_PASSWORD', '')
    dbname = os.environ.get('DB_NAME', 'inventory')
    port = int(os.environ.get('DB_PORT', 3306))

    if use_mariadb:
        conn = mariadb.connect(host=host, user=user, password=password, database=dbname, port=port)
    else:
        conn = pymysql.connect(host=host, user=user, password=password, database=dbname, port=port,
                               cursorclass=DictCursor, autocommit=False)

    return MariaDBConnectionWrapper(conn, use_mariadb)
```

to:

```python
def get_db():
    """Return a MariaDB DB-API connection wrapper.

    Uses a pooled `mariadb` connector connection when available, with an
    unpooled `pymysql` fallback if the `mariadb` package isn't installed
    (not the actual deployment target, which does have it).
    """
    try:
        import mariadb  # noqa: F401 -- import check only; _get_pool() does the real import
        use_mariadb = True
    except Exception:
        use_mariadb = False

    if use_mariadb:
        conn = _get_pool().get_connection()
        return MariaDBConnectionWrapper(conn, True)

    try:
        import pymysql
        from pymysql.cursors import DictCursor
    except Exception as e:
        raise RuntimeError('MariaDB driver required: pip install mariadb (or pymysql)') from e

    host = os.environ.get('DB_HOST', 'localhost')
    user = os.environ.get('DB_USER', 'fishuser')
    password = os.environ.get('DB_PASSWORD', '')
    dbname = os.environ.get('DB_NAME', 'inventory')
    port = int(os.environ.get('DB_PORT', 3306))
    conn = pymysql.connect(host=host, user=user, password=password, database=dbname, port=port,
                           cursorclass=DictCursor, autocommit=False)
    return MariaDBConnectionWrapper(conn, False)
```

`MariaDBConnectionWrapper` and `MariaDBCursorWrapper` (below `get_db()`) are unchanged — `close()` already just calls `self._conn.close()`, which is exactly what returns a pooled connection to the pool instead of disconnecting it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /home/aquaculture/Fish-Counter && PYTHONPATH=. .venv/bin/python -m unittest tests.test_api.test_db_pool -v`
Expected: `OK` (2 tests) — this hits the real local MariaDB via the `.env` credentials already configured in this repo.

- [ ] **Step 6: Compile-check**

Run: `cd /home/aquaculture/Fish-Counter && python3 -m py_compile backend/core/db.py`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add backend/core/db.py tests/test_api/test_db_pool.py
git commit -m "feat: add MariaDB connection pooling to get_db()"
```

---

## Verification (final, whole-plan)

- `python3 -m py_compile vision/fish_counter.py vision/count_reporter.py backend/core/config.py backend/core/db.py` — clean.
- `PYTHONPATH=. .venv/bin/python -m unittest tests.test_vision.test_count_reporter tests.test_api.test_db_pool -v` — all 7 tests pass.
- `sudo systemctl restart fish-counter.service`, confirm healthy via `journalctl -u fish-counter.service` (no import errors, no crash loop) — per this session's established backend-change verification pattern.
- Manual smoke test (documented in the spec's Testing section, to be done once real camera/fish access is available — not blocking this plan's completion since no live camera exists in this environment): run a counting session, confirm the live count in the browser still advances at roughly 1-second granularity, confirm `readings` table rows accumulate at roughly 1/sec of active counting rather than 1/fish, and confirm a Stop click's final saved count matches the vision process's own `[DONE] Final count: N` log line.

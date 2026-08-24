# Counting Pipeline Throughput & Reliability

## Context

Kahariam Farms counts roughly 500,000–1,000,000 fish per week through this
system — at the flat ₱0.40/fish rate, that's real money moving through the
`inventory` table weekly. The counting pipeline (`vision/fish_counter.py` →
`POST /api/v1/ingest` → MariaDB) was not built with that throughput in mind.
This spec fixes two related-but-separable problems found via code review
(not yet field-tested at real fish density):

1. **The detection loop blocks on network I/O, once per individual fish.**
   `vision/fish_counter.py:1247` and `:1271` call `post_count(counter)`
   synchronously, inline, every time a fish crosses the counting line.
   `post_count` (`vision/fish_counter.py:705-756`) does a blocking HTTP POST
   (1-2s timeout) to `/api/v1/ingest`, which itself opens a brand-new
   MariaDB connection (`backend/core/db.py:32-60`, no pooling anywhere in
   the app), inserts a row, updates `devices.last_seen`, commits, and emits
   a Socket.IO event — all before the frame loop can process the next
   frame. At sustained multi-fish-per-second throughput this risks frame
   lag, which is how real fish get missed or double-counted: a direct
   accuracy/revenue risk, not just a "feels slow" one.

2. **The `readings` table grows forever, unread.** It gets one row per
   individual fish (`backend/api/ingest.py:44`), has no index beyond its
   auto-increment primary key (`backend/core/db.py:184-194`), stores a full
   JSON payload per row, and — confirmed by grepping the whole `backend/`
   tree — is never read by any route or feature. At this volume that's
   ~26-52 million unindexed rows/year accumulating on a Raspberry Pi 5's
   limited storage.

A third item surfaced while investigating #1: the vision subprocess's
existing failure fallback (`LEGACY_UPDATE_COUNT_URL`, pointing at
`/update_count`) is silently broken today. Earlier this session
`@require_auth` was added to every route in `counting.py`, including
`/update_count` — but the vision device has no user JWT, only a device
token used solely against `/api/v1/ingest`. This spec removes that
fallback path rather than re-authenticating it (see Approach below).

**Non-goals:** no change to detection/tracking accuracy itself (YOLO model,
Kalman tracker) — this is purely about the pipeline that reports counts,
not how they're computed. No change to the `inventory` table or
`/save_inventory` flow (that's driven by the browser's live count state,
not the `readings` table — see Data Flow below). No new pip/npm
dependencies.

## Current State (verified)

- `runtime.fish_count` (`backend/core/runtime.py:11`) is the single
  in-memory source of truth for "the current live count" — `GET /get_count`
  (`backend/api/counting.py:339-341`) reads it directly. It is **not**
  derived from the `readings` table.
- `/api/v1/ingest` (`backend/api/ingest.py:10-62`) treats the `count` field
  as the **cumulative running total** (not a delta) and does
  `runtime.fish_count = count` — a plain assignment. `class_counts` is
  optional and, when present, is the cumulative per-variant breakdown.
- The vision loop's `counter` variable is the same cumulative total,
  incremented locally (`counter += 1`, no I/O) on every crossing, then
  passed as-is to `post_count(counter)`.
- The browser's displayed/saved count (`Counter.jsx`) comes from Socket.IO
  `reading` events and the `/get_count` poll fallback — i.e. it already
  depends on `runtime.fish_count`/the socket broadcast, not on the
  `readings` table. Slowing down `readings` writes has no effect on what
  gets saved to inventory.
- `backend/core/db.py:32-60`'s `get_db()` opens a new `mariadb.connect(...)`
  (or `pymysql.connect(...)` fallback) on every call, wrapped in
  `MariaDBConnectionWrapper`/`MariaDBCursorWrapper` so callers always see
  `.cursor()`/`.close()`/`.commit()` regardless of driver. Every route
  handler in the app calls `get_db()` once and `conn.close()` at the end —
  dozens of call sites across `inventory.py`, `settings.py`, `auth_otp.py`,
  `counting.py`, `ingest.py`, `locks.py`, `devices.py`.
- The `mariadb` Python connector (v1.1.14, confirmed installed) supports
  native pooling: `mariadb.ConnectionPool(pool_name=..., pool_size=...,
  **connect_kwargs)` with `.get_connection()`, and — per the connector's
  documented behavior — calling `.close()` on a pooled connection returns
  it to the pool instead of truly disconnecting. This means every existing
  `conn.close()` call site keeps working unchanged once `get_db()`'s
  internals switch to pooling.
- `vision/fish_counter.py` has **no signal handler** anywhere (verified by
  grep) and no `try`/`finally` around the main loop
  (`run_counter`, `vision/fish_counter.py:960-1367`). Its "Cleanup" section
  (`:1356-1367`, releasing the camera, printing the final count) only runs
  if the `while True:` loop naturally `break`s — a failed frame read, or
  'q'/ESC in preview mode. A `SIGTERM` (what `POST /stop`,
  `backend/api/counting.py:288-294`, sends — `terminate()` then a 5s grace
  window before `kill()`) currently just ends the process immediately,
  skipping that cleanup. This is not a problem *today* because every fish's
  count is already sent synchronously and immediately — but it becomes one
  once sends are batched (see Approach).

## Approach

### 1. Vision-side: background interval sender, not per-fish blocking calls

`counter += 1` and local class-count bookkeeping stay exactly as they are
today (cheap, no I/O, not the problem). What changes is *when and how* the
count reaches the backend:

- A daemon background thread, started once near the top of `run_counter`,
  wakes every `INGEST_INTERVAL_SECONDS` (new env var, default `1.0`,
  matching the granularity of the Counter screen's existing 1-second poll
  fallback so the UI's live feel is unchanged) and — if the cumulative
  count has changed since the last successful send — calls the *existing*
  `post_count(counter)` function with the current cumulative total, exactly
  the same payload shape as today.
- The frame-processing loop itself never calls `post_count` and never
  blocks on it. It only ever touches the local `counter` variable.
- Failure handling is intentionally simple: since each send carries the
  **current cumulative total** (not a delta), a failed or skipped send
  self-heals on the next tick — no retry queue, no delta bookkeeping, no
  lost-update risk beyond the current interval's window.

### 2. `readings` table — no schema or endpoint change needed

Because `/api/v1/ingest` already just accepts-and-stores whatever `count`
it's given, moving from per-fish to per-second sends is entirely a
vision-side change. The `readings` table automatically goes from one row
per fish to roughly one row per second of active counting — no migration,
no new cleanup job, matching the "one row per batch" choice already made.

### 3. Graceful shutdown — closing the new gap

Add a `SIGTERM` handler in `fish_counter.py` that sets a
`threading.Event` checked at the top of the main loop, so `POST /stop`
causes a clean `break` instead of an abrupt kill (well within the existing
5-second grace window before `/stop` escalates to `SIGKILL`). On the way
out, after the existing Cleanup section: stop the background sender thread,
then do **one direct, blocking `post_count(counter)` call** (bypassing the
interval — we're exiting anyway) so the last few seconds of freshly-counted
fish are never lost from the backend's view before a Stop/Save.

### 4. Backend: connection pooling

`backend/core/db.py` gets a lazily-created, thread-safe module-level
`mariadb.ConnectionPool` (`pool_size` from a new `DB_POOL_SIZE` env var,
default `10` — reasonable for a single-Pi, few-concurrent-client
deployment). `get_db()`'s `mariadb`-available branch calls
`_get_pool().get_connection()` instead of `mariadb.connect(...)`; every
other line in `db.py`, and every one of the dozens of `get_db()`/
`conn.close()` call sites across the app, is unchanged — pooled-connection
`.close()` already returns the connection to the pool. The `pymysql`
fallback branch (used only when the `mariadb` package isn't installed —
not the actual deployment, which does have it) is left as unpooled
per-call connections; adding a pool there would mean a new dependency
(`DBUtils`) for a path that isn't actually used in production.

### 5. Remove the broken device fallback

`LEGACY_UPDATE_COUNT_URL` and the two `try: primary / except: fallback`
blocks in `post_count_with_urllib` and `post_count_with_requests`
(`vision/fish_counter.py:705-756`) are deleted. With the interval sender's
self-healing retry-next-tick behavior, the fallback's original purpose
(don't lose a count update if one request fails) is already covered more
robustly — without needing a second, now-broken, unauthenticated endpoint.
A failed send just logs a warning and tries again in
`INGEST_INTERVAL_SECONDS`.

## Data Flow (after this change)

```
Frame loop (main thread):
  fish crosses line → counter += 1 (local, no I/O) → loop continues immediately

Background sender thread (every INGEST_INTERVAL_SECONDS):
  if counter changed since last send:
    post_count(counter)  →  POST /api/v1/ingest
                              → pool.get_connection()
                              → INSERT INTO readings (~1 row/sec, not 1/fish)
                              → UPDATE devices.last_seen
                              → commit(); conn.close() [returns to pool]
                              → runtime.fish_count = counter
                              → socketio.emit('reading', {count: counter})

Browser (Counter.jsx):
  Socket.IO 'reading' event OR 1s /get_count poll → live count display
  (unchanged — already ~1s-granularity dependent, so no UX regression)

SIGTERM (POST /stop):
  main loop breaks cleanly → sender thread stopped → one final
  synchronous post_count(counter) → camera released → process exits
```

## Error Handling

- A send failure (network error, non-2xx response) is caught, logged
  (`print("[WARN] ...")`, matching the existing style), and simply retried
  on the next interval tick with the (possibly now-higher) cumulative
  count — no queue, no exponential backoff, no dead-letter handling. This
  is deliberately the simplest approach that's still correct, because the
  cumulative-total design makes every send idempotent-in-effect.
- Pool exhaustion (all `pool_size` connections in use) surfaces as a
  `mariadb` exception from `get_connection()` — existing route handlers
  already wrap their DB work in `try`/`except`/`finally: conn.close()`
  patterns per the current codebase style, so this degrades the same way a
  connection failure does today, just rarer.
- The SIGTERM handler itself must not raise — if the final flush's
  `post_count` call fails, it's logged and the process still exits
  cleanly (camera release must not be skipped because of a failed network
  call).

## Testing

No live camera or real fish are available in this environment. Verification is:

- **Vision-side logic**: a short, non-interactive script/test that fakes
  `post_count` (records calls instead of doing HTTP) and a fast
  `INGEST_INTERVAL_SECONDS` (e.g. `0.05`), drives a simulated sequence of
  `counter` increments, and asserts (a) the fake `post_count` is called
  roughly once per interval rather than once per increment, (b) it's
  never called with a stale/lower value than the current `counter`, and
  (c) triggering the SIGTERM handler's shutdown path produces exactly one
  final call with the latest `counter` value after the sender thread has
  stopped.
- **Backend pooling**: a script that calls `get_db()` repeatedly (more
  times than `DB_POOL_SIZE`) and confirms each call succeeds and returns a
  working, queryable connection, and that `_get_pool()` only constructs
  the pool once even when called concurrently from multiple threads.
- **Ingest endpoint**: unchanged behavior — reuse the same manual
  curl-based checks already used earlier this session (`backend/api/
  ingest.py` unauthenticated-321 request, checked via `journalctl` and
  direct `curl`/DB queries) to confirm `POST /api/v1/ingest` still inserts
  and broadcasts correctly with the connection now sourced from the pool.
- **Manual smoke test**: run the vision pipeline against the existing
  `evaluation/`/`process_videos.py` test video assets (or a short live
  camera session if available) for a few minutes, confirm the live count
  in the browser keeps advancing at roughly 1-second granularity, confirm
  the `readings` table row count matches "roughly 1/sec of active
  counting" rather than "1/fish", and confirm a Stop click's final saved
  count matches the vision process's own final `[DONE] Final count: N`
  log line.

## Verification

- `python3 -m py_compile vision/fish_counter.py backend/core/db.py
  backend/api/ingest.py` — clean.
- The automated checks under Testing above pass.
- Manual smoke test (above) confirms no regression in live-count UX and
  confirms the readings-table row-rate drop.
- `sudo systemctl restart fish-counter.service` after backend changes,
  confirmed healthy via `journalctl`, per this session's established
  verification pattern.

# Fish Counter — Database Documentation, ERD & Level 1 DFD Analysis

**System:** Kahariam Farm Fish Counter Management System
**Database:** MariaDB, schema name `inventory`
**Analysis date:** 2026-09-20
**Branch analysed:** `ui/panel-fit` (commit `8cd278c`)

---

## How to read this document

Every statement below carries one of three confidence labels:

| Label | Meaning |
| ----- | ------- |
| **[CONFIRMED]** | Verified directly against the running MariaDB server (`information_schema`) or against a specific line of source code, cited as `file:line`. |
| **[INFERRED]** | Not written down anywhere explicitly, but follows necessarily from how the code behaves. The reasoning is always given. |
| **[UNCONFIRMED]** | Cannot be established from the provided source. Stated as such, never guessed. |

**Sources inspected.** The live `inventory` database on `127.0.0.1:3306`;
`database/schema.sql`; all ten files in `database/migrations/`;
`database/planned_schema.sql`; `backend/core/db.py`; all nine blueprints in
`backend/api/`; `frontend/src/App.jsx`, `frontend/src/utils/`, and every component in
`frontend/src/components/`; `vision/fish_counter.py`; `scripts/utils/`.

**A note on the word "authoritative."** `database/schema.sql` describes itself as the
single source of truth. It is very nearly right, but it is one table out of date. Where
the file and the running server disagree, **this document follows the running server**,
and the difference is recorded in Section 12.

---

## 1. System Database Overview

Fish Counter is a single-database web application. One MariaDB schema, `inventory`,
holds everything. There is no second database, no cache layer, and no ORM — every
statement in the system is hand-written SQL executed through a thin DB-API wrapper in
[backend/core/db.py](backend/core/db.py).

**Live structure [CONFIRMED — queried from `information_schema`]:**

| Property | Value |
| -------- | ----- |
| Engine | InnoDB (all 13 tables) |
| Tables | **13** |
| Foreign keys | **5** |
| Views | **0** |
| Triggers | **0** |
| Stored procedures / functions | **0** |
| Scheduled events | **0** |
| Character set | `utf8mb4` |

Because there are no views, triggers or stored procedures, **all business logic lives in
Python**. Nothing happens inside the database on its own. This matters for your DFD: every
process you draw is a piece of application code, never a database-side rule.

### What the system actually does

The farm counts juvenile fish ("fry") as they pass a camera, then records the counted
batch as stock, sells stock wholesale, and tracks feed purchases. Three things run
concurrently:

1. **A computer-vision counter** ([vision/fish_counter.py](vision/fish_counter.py)) runs
   as a separate operating-system process on a Raspberry Pi 5, watches a camera, and
   POSTs running counts to the web API.
2. **A Flask web API** ([backend/app.py](backend/app.py)) serves the React frontend,
   owns the database, and starts/stops the counter process.
3. **A React single-page app** ([frontend/src/](frontend/src/)) runs in Firefox on a
   7-inch touchscreen panel attached to the Pi, and on ordinary browsers over the LAN.

### Two design conventions you must understand before reading the tables

**Convention 1 — Soft deletes, two different kinds.** The `inventory` table has *two*
separate "hidden" flags that mean different things, and confusing them will make your
ERD and your data dictionary wrong:

- `deleted = 1` removes a row from **every stock and revenue calculation**. It is a
  genuine data correction. Set by `/undo_save` ([backend/api/inventory.py:434](backend/api/inventory.py#L434)).
- `is_archived = 1` hides a row from the **active UI list only**. The row still counts
  toward stock totals. Set by `/delete_inventory` ([backend/api/inventory.py:393](backend/api/inventory.py#L393)).

This is deliberate and documented in `database/migrations/add_is_archived.sql`.

**Convention 2 — Stock is a running sum, never a stored balance.** There is no
`stock_level` column anywhere. Current stock is recalculated on every request by summing
signed `count` values out of `inventory`
([backend/api/inventory.py:1655](backend/api/inventory.py#L1655)). Fish coming in are
stored as positive counts; fish going out are stored as **negative** counts. Your ERD
therefore has no "stock" entity — only a movement ledger.

---

## 2. Complete Table List

[CONFIRMED — every row below read from the live server.]

| Table | Purpose | Primary Key | Foreign Keys | Main Function |
| ----- | ------- | ----------- | ------------ | ------------- |
| `users` | One row per person who can log in. Role is a column here; there is no separate roles table. | `id` (bigint unsigned, auto) | *(none out)* | Identity, authentication, and admin-vs-staff authorisation. |
| `inventory` | The core business ledger. One row per stock movement (fish counted in, sold, or died). | `id` (int, auto) | *(none)* | Every stock figure, revenue figure and report in the system is derived from this table. |
| `counting_sessions` | One row per counting run: who ran it, on which device, for how long, and whether it ever reached inventory. | `id` (int, auto) | *(none — 3 logical refs)* | Turns a counting run into a reviewable historical record. |
| `counting_state` | A single shared row (`id = 1`) holding the start/stop flag. | `id` (int, no auto-increment) | *(none)* | Keeps the Start/Stop toggle synchronised across every connected device. |
| `devices` | Registry of physical counter units. Also holds the kiosk reservation lock. | `id` (varchar(255), a UUID) | *(none out)* | Authenticates hardware at `/api/v1/ingest`, and prevents two operators driving one counter at once. |
| `readings` | Raw telemetry: each count the Pi reports. | `id` (bigint unsigned, auto) | `device_id` → `devices.id` | Audit trail of raw sensor output. **Written but never read** — see Section 12. |
| `feed_purchases` | One row per feed delivery bought for the farm. | `id` (int, auto) | *(none)* | The next-purchase countdown alert is computed from the most recent row. |
| `otp_codes` | Hashed one-time login codes, 5-minute validity. | `id` (bigint unsigned, auto) | *(none — logical only)* | Second factor of the two-step login. |
| `password_resets` | Hashed password-reset tokens, 30-minute validity. | `id` (bigint unsigned, auto) | *(none — links by email)* | "Forgot password" flow, plus its per-email rate limit. |
| `user_sessions` | One row per issued JWT, keyed by the token's `jti` claim. | `id` (bigint unsigned, auto) | `user_id` → `users.id` | Lets a user see and revoke their own active sessions. |
| `login_history` | Every sign-in attempt, successful or failed. | `id` (bigint unsigned, auto) | `user_id` → `users.id` | Feeds the Security tab, **and is the actual source of account-lockout counting**. |
| `notification_prefs` | Per-user notification toggles. At most one row per user. | `id` (bigint unsigned, auto) | `user_id` → `users.id` (UNIQUE) | Stores the Notifications tab settings. |
| `audit_logs` | Administrative action trail. | `id` (bigint unsigned, auto) | `user_id` → `users.id` | Records who changed what, for the admin audit view. |

---

## 3. Detailed Table and Column Explanation

All 107 columns across 13 tables. Data types are exactly as the live server reports them.

### TABLE: `users`

**Purpose.** The identity table. One row per human operator. This system has no separate
`roles` table — authorisation is a single `role` column, a design decision recorded in
`database/planned_schema.sql:25` where the normalised alternative is preserved as a
commented-out record of the option that was rejected.

Live content [CONFIRMED]: 3 rows — one `admin`, two `staff`.

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | bigint(20) unsigned | **PK**, auto_increment | Surrogate user identifier | Placed in the JWT `sub`/`uid` claims at [auth_otp.py:198](backend/api/auth_otp.py#L198). Every user-owned table points here. | Yes |
| `username` | varchar(150) | **UNIQUE** | Login name | Matched at login, alongside email, at [auth_otp.py:407](backend/api/auth_otp.py#L407). Uniqueness re-checked before any rename at [settings.py:175](backend/api/settings.py#L175). | Yes |
| `password_hash` | varchar(255) | — | bcrypt hash of the password | Compared with `bcrypt.checkpw` at [auth_otp.py:436](backend/api/auth_otp.py#L436). Rewritten by password change, password reset, and admin credential resend. | Yes |
| `email` | varchar(255) | nullable | Contact address | The destination for OTP codes ([auth_otp.py:97](backend/api/auth_otp.py#L97)), reset links, and new-account credentials. Also an alternative login identifier. An account with no email **cannot complete login**, because the OTP has nowhere to go. | No (but login fails without it) |
| `role` | enum('admin','staff') | NOT NULL, default `'staff'` | Authorisation level | Copied into the JWT, then checked by the `require_admin` decorator at [settings.py:53](backend/api/settings.py#L53). Also decides which navigation tabs render, at [App.jsx:23](frontend/src/App.jsx#L23). | Yes |
| `active` | tinyint(1) | default 1 | Account enabled flag | An inactive account is refused at login with the same generic message as a wrong password ([auth_otp.py:416](backend/api/auth_otp.py#L416)) so it leaks nothing. Toggled by an admin. | No |
| `created_at` | timestamp | default CURRENT_TIMESTAMP | Account creation time | Displayed in the Account tab; used as the sort order of the staff list ([settings.py:587](backend/api/settings.py#L587)). | No |
| `fullname` | varchar(200) | nullable | Person's display name | Shown in Settings and the staff list. Purely presentational. | No |
| `profile_image` | text | nullable | A complete `data:` URI of the avatar | Written as base64 by [settings.py:247](backend/api/settings.py#L247), capped at 2 MB. Stored in the database rather than on disk, so the image travels with the row. | No |
| `last_login` | datetime | nullable | Timestamp of last successful sign-in | Set with `NOW()` after OTP verification at [auth_otp.py:668](backend/api/auth_otp.py#L668). Displayed in Account and the staff list. | No |
| `failed_attempts` | int(10) unsigned | NOT NULL, default 0 | Intended failed-login counter | **Read but never written.** Returned by [settings.py:141](backend/api/settings.py#L141); no `UPDATE` anywhere sets it. Real lockout counting uses `login_history` instead. See Section 12. | No |
| `updated_at` | datetime | ON UPDATE CURRENT_TIMESTAMP | Last modification time | Set explicitly by every profile/password/role update. Not currently displayed. | No |
| `sessions_invalidated_at` | datetime | nullable | "Log out everywhere" cut-off | Set by [settings.py:935](backend/api/settings.py#L935). On every authenticated request, a JWT issued *before* this moment is rejected ([auth_otp.py:248](backend/api/auth_otp.py#L248)). This is how logout-all works for tokens that predate session tracking. | No |

---

### TABLE: `inventory`

**Purpose.** The central business table and the origin of every number the farm sees. One
row per stock movement. Despite the table name, it is a **ledger of movements**, not a
list of items held.

Live content [CONFIRMED]: 199 rows, all of variant `SPIN_20`, split as 21 `WHOLESALE_IN`
rows and 186 `SOLD` rows.

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | int(11) | **PK**, auto_increment | Movement identifier | Returned to the Counter screen so a save can be undone within 120 seconds ([inventory.py:248](backend/api/inventory.py#L248)). Also the value `counting_sessions.inventory_id` is meant to hold. | Yes |
| `count` | int(11) | NOT NULL | Number of fish moved — **signed** | **Positive = stock in, negative = stock out.** Every balance is `SUM(count)` ([inventory.py:1655](backend/api/inventory.py#L1655)). The sign convention is what makes a single column serve both directions. The API always returns `abs(count)` to the browser ([inventory.py:81](backend/api/inventory.py#L81)), so the sign is a storage detail only. | Yes |
| `variant` | varchar(255) | NOT NULL | Product/species grade | Groups every per-product total. Live data contains exactly one value, `SPIN_20` — the farm sells a single variant, and [inventory.py:822](backend/api/inventory.py#L822) hardcodes that list. | Yes |
| `date` | datetime | NOT NULL | When the movement happened | Written from the Pi's local clock as a naive local datetime. Drives every date filter, every period grouping, and the 120-second undo window ([inventory.py:429](backend/api/inventory.py#L429)). Deliberately *not* UTC — see the comment at [inventory.py:22](backend/api/inventory.py#L22). | Yes |
| `notes` | text | nullable | Free-text remark | Searched case-insensitively by the Inventory and Adjustments search boxes (`LOWER(notes) LIKE ?`). Historically also carried a machine-readable `[AUTO_LINK:WHOLESALE_PARENT_ID=n]` marker, parsed at [inventory.py:176](backend/api/inventory.py#L176). | No |
| `action` | varchar(32) | default `'IN'` | Legacy movement category | The **older** of the system's two classification columns. Values seen in code: `IN`, `OUT`, `WHOLESALE`, `INVENTORY`. Every stock and revenue query still filters on this column, not on `transaction_type`. Live data contains only `WHOLESALE`. | No |
| `transaction_type` | varchar(20) | NOT NULL, default `'TANK_IN'` | Newer, structured movement category | Valid values are `SOLD`, `DIED`, `WHOLESALE_IN` ([inventory.py:33](backend/api/inventory.py#L33)). Its one decisive use is separating a death from a sale: a `DIED` row reduces stock but must **not** produce revenue ([inventory.py:1070](backend/api/inventory.py#L1070)). The column default, `'TANK_IN'`, is no longer a permitted value — see Section 12. | Yes |
| `price` | decimal(10,2) | nullable | Agreed unit price for a sale | Written only by the structured `SOLD` path ([inventory.py:1387](backend/api/inventory.py#L1387)), where it is mandatory; forced NULL for `DIED` and `WHOLESALE_IN`. Returned to the browser — **but no revenue figure is calculated from it.** See Section 12. | No |
| `total_price` | decimal(10,2) | nullable | `price × count`, precomputed | Stored at write time ([inventory.py:1378](backend/api/inventory.py#L1378)) and returned by the API. Like `price`, it is not used by any revenue calculation. | No |
| `deleted` | tinyint(4) | default 0 | **Hard** soft-delete | `1` removes the row from every stock and revenue calculation. Every meaningful query begins `WHERE deleted = 0`. Set only by `/undo_save`, within the 120-second window. | No |
| `is_archived` | tinyint(1) | NOT NULL, default 0, **indexed** | **Soft** soft-delete | `1` hides the row from the active Inventory list while it **continues to count toward stock**. Set by `/delete_inventory` and `/clear_inventory`; cleared by `/restore_record`. The index `idx_is_archived` exists because the default list query filters on it. | Yes |

---

### TABLE: `counting_sessions`

**Purpose.** A counting run as a durable record. Before this table existed, a "session"
was only the transient `counting_state` flag plus, eventually, one `inventory` row — so
nothing recorded who counted, on what, for how long, or whether the run was ever saved.

**Important for your ERD: this table has no foreign keys at all**, despite holding three
columns that reference other tables. All three are logical references only.

Live content [CONFIRMED]: 11 rows — 12 `aborted`, 1 `completed`, 0 `saved` across the
table's history (ids run to 28; low-numbered rows were cleared).

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | int(11) | **PK**, auto_increment | Session identifier | Ordering key for "most recent session"; returned to the Dashboard. | Yes |
| `device_id` | varchar(255) | **no FK** — logical ref to `devices.id` | Which counter unit ran the session | Written from the `DEVICE_ID` environment variable at [counting.py:393](backend/api/counting.py#L393), not from a database lookup. Because there is no FK, a session can name a device that was never registered. | No |
| `user_id` | bigint(20) unsigned | **no FK** — logical ref to `users.id` | Who started the run | Read from the JWT `sub` claim at [counting.py:428](backend/api/counting.py#L428). | No |
| `username` | varchar(120) | — | The operator's name, **denormalised on purpose** | Deliberate duplication of `users.username`, so session history survives a user being renamed or deleted. Documented at `database/migrations/add_counting_sessions.sql:9`. This is the one intentional denormalisation in the schema. | No |
| `variant` | varchar(255) | — | Product being counted | Passed as a query parameter to `/start`. | No |
| `started_at` | datetime | NOT NULL, **indexed** | Run start time | Set when `/start` succeeds. The index serves the Reports date-range query at [reports.py:71](backend/api/reports.py#L71). | Yes |
| `ended_at` | datetime | nullable | Run end time | Set by `/stop`. NULL while a run is in progress. Duration is `ended_at − started_at`, computed in the browser, never stored. | No |
| `final_count` | int(11) | NOT NULL, default 0 | Fish counted in the run | Taken from the in-memory runtime counter at [counting.py:449](backend/api/counting.py#L449). | Yes |
| `status` | varchar(16) | NOT NULL, default `'active'`, **indexed** | Lifecycle state | Four values, each meaning something distinct: `active` (running), `completed` (stopped, not yet saved), `saved` (written to inventory), `aborted` (stopped having counted nothing). The `'active'` value is also used as a lock — opening a new session first marks any stale `active` row as `aborted` ([counting.py:420](backend/api/counting.py#L420)). | Yes |
| `inventory_id` | int(11) | **no FK** — logical ref to `inventory.id` | The inventory row this run produced | Intended to be set when a counted run is saved ([inventory.py:237](backend/api/inventory.py#L237)) and cleared on undo. **Currently NULL in every live row** — see Section 12. | No |

---

### TABLE: `counting_state`

**Purpose.** A single shared row that keeps the Start/Stop toggle consistent across every
device viewing the app. Without it, one browser could show "counting" while another showed
"stopped."

Live content [CONFIRMED]: exactly 1 row, `id = 1`. This is a **singleton table** — note
that `id` has no `AUTO_INCREMENT`, which is what enforces the pattern.

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | int(11) | **PK**, *no* auto_increment | Always the literal `1` | Every query hardcodes `WHERE id=1`. The absence of auto-increment is what prevents a second row being created. | Yes |
| `active` | tinyint(4) | default 0 | Is counting running right now | Read by `/get_state` and locked with `SELECT ... FOR UPDATE` by `/start` ([counting.py:218](backend/api/counting.py#L218)) so two devices cannot both start a run. Changes are broadcast over Socket.IO. | No |
| `updated_at` | datetime | nullable | When the flag last changed | Written on each toggle. Supports the stale-state recovery on startup at [counting.py:160](backend/api/counting.py#L160), which clears a flag left set by a crash. | No |

---

### TABLE: `devices`

**Purpose.** Registry of physical counter hardware. It does double duty: it is both the
**authentication table for machines** and the holder of the **kiosk reservation lock**.

Live content [CONFIRMED]: 1 row, the local Pi, id `3684bbf4-…`.

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | varchar(255) | **PK** | Device UUID | A **natural primary key**, not a surrogate integer — generated with `uuid.uuid4()` at [devices.py:54](backend/api/devices.py#L54). It is the only non-integer PK in the schema. Referenced by `readings.device_id`. | Yes |
| `name` | varchar(120) | nullable | Human-readable label | Shown on the Counter screen via `_device_name()` ([counting.py:396](backend/api/counting.py#L396)). | No |
| `location` | varchar(120) | nullable | Where the unit is installed | Captured at registration; listed in the admin device list. | No |
| `model` | varchar(100) | nullable | Hardware model | Captured at registration; display only. | No |
| `firmware` | varchar(64) | nullable | Firmware version | Captured at registration. The local Pi is seeded with the literal `'local'` ([db.py:245](backend/core/db.py#L245)). | No |
| `secret_hash` | varchar(255) | NOT NULL | **bcrypt hash of the device token** | The machine equivalent of a password. Verified at [auth.py:19](backend/api/auth.py#L19) on every `/api/v1/ingest` call. The plaintext token is displayed **once** at registration and is unrecoverable afterwards. | Yes |
| `created_at` | timestamp | default CURRENT_TIMESTAMP | Registration time | Sort order of the device list. | No |
| `last_seen` | timestamp | nullable, **indexed** | Last successful ingest | Updated on every accepted reading ([ingest.py:46](backend/api/ingest.py#L46)). This is the liveness signal for "is the counter online." | No |
| `active` | tinyint(1) | default 1 | Is the device permitted to send data | `0` makes token verification fail — the query filters `active = 1`. This is how a device is revoked without deleting its history. | No |
| `locked_by` | char(36) | nullable, **no FK** — logical ref to `users.id` | Who currently holds the kiosk lock | Written as a **string** by [locks.py:67](backend/api/locks.py#L67) from the JWT `sub`. It holds a `users.id` but there is no constraint, and the types differ (`char(36)` versus `bigint unsigned`). See Section 12. | No |
| `lock_time` | timestamp | nullable | When the lock was taken | The lock **expires after 3 minutes** ([locks.py:41](backend/api/locks.py#L41)), so an operator who walks away does not block the counter permanently. Expiry is computed on read; nothing clears it on a timer. | No |

---

### TABLE: `readings`

**Purpose.** Raw telemetry. Every count the vision process reports is appended here.

Live content [CONFIRMED]: 53 rows, all from the single registered device.

> **Note for Section 12:** this table is **written but never read**. A search for
> `FROM readings` across the entire codebase returns no result. The live dashboard
> receives counts over Socket.IO, not from this table.

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | bigint(20) unsigned | **PK**, auto_increment | Reading identifier | Insert-only; never referenced. | Yes |
| `device_id` | varchar(255) | **FK → `devices.id`**, ON DELETE CASCADE, indexed | Which unit sent the reading | The **only true foreign key in the system that is not to `users`**. Written with the *verified* device id returned by token checking, never with the client-supplied value ([ingest.py:44](backend/api/ingest.py#L44)) — a caller cannot attribute a reading to someone else's device. | Yes |
| `count` | int(11) | NOT NULL | Fish counted at that instant | Validated as `> 0` before insert ([ingest.py:31](backend/api/ingest.py#L31)), then pushed into the in-memory runtime counter and broadcast. | Yes |
| `timestamp` | timestamp | NOT NULL, default CURRENT_TIMESTAMP, indexed | Server-side receipt time | Written from the **server's** clock, not the device's. Part of the composite index `idx_device_time`. | Yes |
| `firmware` | varchar(64) | nullable | Reported firmware version | Copied from the payload. Not compared against `devices.firmware`. | No |
| `raw_payload` | text | nullable | The complete JSON body as received | Forensic copy, stored via `json.dumps(data)`. Preserves any field the schema does not model. | No |
| `rssi` | int(11) | nullable | Wireless signal strength | Accepted from the payload. The local Pi posts over loopback HTTP, so this is always NULL in practice. | No |
| `created_at` | timestamp | default CURRENT_TIMESTAMP | Row insertion time | Redundant with `timestamp` in current usage — both are set to the moment of insert. | No |

---

### TABLE: `feed_purchases`

**Purpose.** The record from which the feed-purchasing alert is derived. The farm buys
feed roughly every 14 days.

**The alert itself is never stored.** It is recomputed on every read from the latest
purchase date ([feed.py:61](backend/api/feed.py#L61)), so recording, correcting or
deleting a purchase moves the countdown with nothing to invalidate. This is a clean piece
of design worth pointing out in a thesis defence: *derived values are not persisted.*

Live content [CONFIRMED]: 2 rows.

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | int(11) | **PK**, auto_increment | Purchase identifier | Addresses the row for edit and delete; written into `audit_logs.object_id`. | Yes |
| `purchased_on` | **date** | NOT NULL | Calendar day of purchase | A `DATE`, **not** a `DATETIME`, deliberately: the schedule is in whole days, and a time-of-day would let the countdown drift across midnight (`add_feed_purchases.sql:10`). The next due date is this value + 14 days. | Yes |
| `amount` | decimal(10,2) | NOT NULL | Peso cost | Validated as `> 0` and `≤ 99,999,999.99` at [feed.py:134](backend/api/feed.py#L134). Displayed in the purchase history. | Yes |
| `notes` | varchar(255) | nullable | Free-text remark | Length-checked before insert. Display only. | No |
| `deleted` | tinyint(1) | NOT NULL, default 0 | Soft delete | Same convention as `inventory.deleted`. Every read filters `deleted = 0`. A deleted purchase stops influencing the countdown but is retained. | Yes |
| `created_at` | timestamp | default CURRENT_TIMESTAMP | When the record was typed in | Distinct from `purchased_on`, which is when the feed was actually bought — this is what makes backfilling an older purchase possible without disturbing the countdown ([feed.py:98](backend/api/feed.py#L98) orders by `purchased_on`, not by `created_at`). | No |

---

### TABLE: `otp_codes`

**Purpose.** Second factor of the two-step login. Codes are six digits, stored as SHA-256
hashes, valid for five minutes, three attempts maximum.

Live content [CONFIRMED]: 36 rows.

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | bigint(20) unsigned | **PK**, auto_increment | Code identifier | Targets the `UPDATE` that marks a code used or increments its attempts. | Yes |
| `user_id` | bigint(20) unsigned | **no FK** — logical ref to `users.id`; indexed | Whose code this is | Part of the composite index `idx_otp_user_expires`. **Unlike every other user-owned table, this one has no foreign key** — `database/schema.sql:156` records this as a deliberate preservation of how the live database was built. | Yes |
| `otp_code` | varchar(255) | NOT NULL | **SHA-256 hash** of the six digits | Never the plaintext code. Compared with `hmac.compare_digest` at [auth_otp.py:636](backend/api/auth_otp.py#L636) — a constant-time comparison, so response timing cannot reveal how many digits were right. | Yes |
| `expires_at` | datetime | NOT NULL | Expiry moment (issued + 5 min) | Checked before comparison; an expired code is marked used rather than left reusable ([auth_otp.py:630](backend/api/auth_otp.py#L630)). | Yes |
| `attempts` | int(10) unsigned | NOT NULL, default 0 | Wrong guesses against this code | Incremented on each failure; at 3 the code is burned ([auth_otp.py:620](backend/api/auth_otp.py#L620)). This is per-code, not per-account. | Yes |
| `used` | tinyint(1) | NOT NULL, default 0 | Has this code been consumed | Set on success, on expiry, on attempt exhaustion, when a newer code is issued, and when the password is reset. Only `used = 0` rows are candidates. | Yes |
| `created_at` | timestamp | default CURRENT_TIMESTAMP | When the code was issued | Drives resend throttling — a 60-second cooldown and a cap of 6 per hour, both computed from the **database** clock via `TIMESTAMPDIFF` ([auth_otp.py:527](backend/api/auth_otp.py#L527)) so they never depend on the app and MariaDB agreeing about timezones. | No |

---

### TABLE: `password_resets`

**Purpose.** "Forgot password" tokens. Note this table keys on **email**, not on user id —
so it can record a reset attempt for an address that has no account, which is what makes
the anti-enumeration behaviour possible.

Live content [CONFIRMED]: 0 rows.

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | bigint(20) unsigned | **PK**, auto_increment | Token identifier | Targets the "mark used" update. | Yes |
| `email` | varchar(255) | indexed | Address the reset was requested for | **The link to a user is by email string, not by id.** A row is inserted even when no such user exists ([auth_otp.py:945](backend/api/auth_otp.py#L945)), so an attacker cannot tell registered addresses from unregistered ones. The index `idx_pr_email_created` backs the rate-limit `COUNT(*)`. | Yes |
| `token_hash` | varchar(64) | indexed | **SHA-256 hex** of the reset token | Only the hash is stored; the raw token exists only in the emailed link ([auth_otp.py:748](backend/api/auth_otp.py#L748)). A database leak cannot be replayed into account takeover. | Yes |
| `expires_at` | datetime | NOT NULL | Expiry moment (issued + 30 min) | Checked on both validate and consume. | Yes |
| `used` | tinyint(1) | NOT NULL, default 0 | Single-use flag | Prevents replay. Also set when the token resolves to no user, so a probe cannot be retried. | Yes |
| `ip_address` | varchar(45) | nullable | Requester's IP | Sized for IPv6. Recorded for forensics; not displayed anywhere. | No |
| `created_at` | timestamp | default CURRENT_TIMESTAMP | Request time | The window for the rate limit: 3 requests per email per hour ([auth_otp.py:924](backend/api/auth_otp.py#L924)). | No |

---

### TABLE: `user_sessions`

**Purpose.** One row per issued JWT, so a user can see and revoke their own active
sessions. This is what turns a stateless token into something revocable.

Live content [CONFIRMED]: 18 rows.

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | bigint(20) unsigned | **PK**, auto_increment | Session row identifier | The handle the Security tab passes to `DELETE /sessions/<id>`. | Yes |
| `user_id` | bigint(20) unsigned | **FK → `users.id`**, ON DELETE CASCADE, indexed | Session owner | Scopes the list, and is re-checked on revoke so one user cannot revoke another's session ([settings.py:891](backend/api/settings.py#L891)). | Yes |
| `session_token` | varchar(64) | **UNIQUE** | The JWT's `jti` claim (a UUID v4) | **Not the token itself** — only its unique id, so the database never holds a usable credential. Looked up on every authenticated request ([auth_otp.py:253](backend/api/auth_otp.py#L253)); `is_active = 0` rejects the request. The UNIQUE index serves that per-request lookup. | Yes |
| `ip_address` | varchar(45) | nullable | Where the session signed in from | Displayed in the Security tab so a user can spot an unfamiliar location. | No |
| `device` | text | nullable | User-Agent string, truncated to 255 | Displayed as "device" in the session list. | No |
| `created_at` | datetime | NOT NULL, default CURRENT_TIMESTAMP | Sign-in time | Shown in the session list. | Yes |
| `last_seen` | datetime | NOT NULL, ON UPDATE CURRENT_TIMESTAMP | Most recent activity | Sort order of the session list (most recent first). Maintained by the column's own `ON UPDATE` clause rather than by an explicit write. | Yes |
| `is_active` | tinyint(1) | NOT NULL, default 1 | Revocation flag | `0` means revoked. Sessions are **never deleted**, only deactivated, so the history survives. | Yes |

---

### TABLE: `login_history`

**Purpose.** Every sign-in attempt. This table has a second job that is easy to miss: it
is the **actual source of truth for account lockout**, a role the `users.failed_attempts`
column looks like it should fill but does not.

Live content [CONFIRMED]: 18 rows.

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | bigint(20) unsigned | **PK**, auto_increment | Attempt identifier | Used in the lockout query as a **monotonic ordering key**: failures are counted only where `id >` the id of the last success ([auth_otp.py:310](backend/api/auth_otp.py#L310)). Comparing by id rather than by time is deliberate — `login_time` is only second-granular, so a failure in the same second as a success would otherwise slip through. | Yes |
| `user_id` | bigint(20) unsigned | **FK → `users.id`**, ON DELETE CASCADE, indexed | Whose attempt | Scopes both the history view and the lockout count. Part of `idx_lh_user_time`. | Yes |
| `ip_address` | varchar(64) | NOT NULL, default `''` | Source IP | Honours `X-Forwarded-For`. Displayed in the Security tab. | Yes |
| `device` | varchar(255) | NOT NULL, default `''` | User-Agent, truncated | Displayed alongside the attempt. | Yes |
| `login_time` | datetime | NOT NULL, default CURRENT_TIMESTAMP | When the attempt happened | Bounds the lockout window (`NOW() - INTERVAL 15 MINUTE`). Sort order of the history list. | Yes |
| `status` | enum('success','failed') | NOT NULL, default `'success'` | Outcome | The discriminator the whole lockout rule turns on: 5 `failed` rows inside 15 minutes, newer than the last `success`, locks the account ([auth_otp.py:423](backend/api/auth_otp.py#L423)). A successful sign-in clears the slate. | Yes |

---

### TABLE: `notification_prefs`

**Purpose.** Per-user notification toggles from the Settings → Notifications tab.

Live content [CONFIRMED]: **0 rows.** The table is fully implemented on both sides but has
never been written to in this installation — the GET returns hardcoded defaults when no
row exists ([settings.py:390](backend/api/settings.py#L390)), so the feature appears to
work. See Section 12.

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | bigint(20) unsigned | **PK**, auto_increment | Row identifier | Surrogate key only; the code always addresses rows by `user_id`. | Yes |
| `user_id` | bigint(20) unsigned | **FK → `users.id`**, ON DELETE CASCADE, **UNIQUE** | Owner | The UNIQUE constraint is what makes this relationship **1:1** rather than 1:M — it is structurally impossible for a user to have two preference rows. | Yes |
| `email_notifications` | tinyint(1) | NOT NULL, default 1 | Master email toggle | Stored and returned. **[UNCONFIRMED]** — no code was found that consults this value before sending mail; OTP and reset emails send unconditionally. | Yes |
| `inventory_alerts` | tinyint(1) | NOT NULL, default 1 | Stock alert toggle | Stored and returned; no consuming code found. **[UNCONFIRMED]** | Yes |
| `revenue_alerts` | tinyint(1) | NOT NULL, default 1 | Revenue alert toggle | Stored and returned; no consuming code found. **[UNCONFIRMED]** | Yes |
| `anomaly_alerts` | tinyint(1) | NOT NULL, default 1 | Anomaly alert toggle | Stored and returned; no consuming code found. **[UNCONFIRMED]** | Yes |
| `task_reminders` | tinyint(1) | NOT NULL, default 1 | Task reminder toggle | Stored and returned; no consuming code found. **[UNCONFIRMED]** | Yes |
| `system_warnings` | tinyint(1) | NOT NULL, default 1 | System warning toggle | Stored and returned; no consuming code found. **[UNCONFIRMED]** | Yes |
| `updated_at` | datetime | ON UPDATE CURRENT_TIMESTAMP | Last change | Set on save; not displayed. | No |

---

### TABLE: `audit_logs`

**Purpose.** The administrative action trail — who changed what, and from where.

Live content [CONFIRMED]: 26 rows.

| Column | Data Type | Key/Constraint | What It Stores | How the System Uses It | Required? |
| ------ | --------- | -------------- | -------------- | ---------------------- | --------- |
| `id` | bigint(20) unsigned | **PK**, auto_increment | Entry identifier | Returned to the admin audit view. | Yes |
| `user_id` | bigint(20) unsigned | **FK → `users.id`**, **ON DELETE SET NULL**, indexed | Who performed the action | **The only `SET NULL` foreign key in the schema**, and the choice matters: deleting a user must not erase the audit trail of what they did. The entry survives, orphaned, and the admin view renders it as `'system'` ([settings.py:824](backend/api/settings.py#L824)). | No |
| `action` | varchar(100) | NOT NULL | What happened | An uppercase verb: `UPDATE_PROFILE`, `CHANGE_PASSWORD`, `CREATE_STAFF`, `UPDATE_STAFF`, `ACTIVATE_STAFF`, `DEACTIVATE_STAFF`, `RESEND_CREDENTIALS`, `REVOKE_SESSION`, `LOGOUT_ALL_SESSIONS`, `CREATE_FEED_PURCHASE`, `UPDATE_FEED_PURCHASE`, `DELETE_FEED_PURCHASE`. Displayed verbatim. | Yes |
| `object_type` | varchar(50) | nullable | Which table was affected | Either `'users'`, `'user_sessions'` or `'feed_purchases'`. Displayed in the audit view. | No |
| `object_id` | varchar(50) | nullable | Which row was affected | **Written but never read.** `get_audit_logs` ([settings.py:805](backend/api/settings.py#L805)) does not select this column, so it cannot reach the UI. 33 rows carry a value. See Section 12. | No |
| `details` | text | nullable | Human-readable context | For example `Created staff account: superjz`. Displayed in the audit view. | No |
| `ip_address` | varchar(45) | nullable | Where the action came from | Captured on every write; not currently displayed. | No |
| `created_at` | datetime | NOT NULL, default CURRENT_TIMESTAMP, indexed | When it happened | Sort order (newest first) for both the admin audit view and the per-user Security tab. The index `idx_audit_logs_created` serves that ordering. | Yes |

---

## 4. CRUD / Module Usage

Who does what to which table. **Actor** is established from the route's decorators:
`@require_auth` means any signed-in user; `@require_admin` means role `admin` only; no
decorator plus device-token verification means the hardware.

| Table | System Module | Operation | User/Actor | Purpose | Related Tables |
| ----- | ------------- | --------- | ---------- | ------- | -------------- |
| `users` | Login (`POST /api/v1/auth/login`) | READ | Anonymous | Look up account by username **or** email; verify bcrypt hash | `login_history`, `otp_codes` |
| `users` | Verify OTP (`POST /api/v1/auth/verify-otp`) | READ, UPDATE | Anonymous (holding OTP token) | Read identity for the JWT; set `last_login` | `otp_codes`, `login_history`, `user_sessions` |
| `users` | Every authenticated request (`require_auth`) | READ | Admin, Staff | Check `sessions_invalidated_at` for logout-all | `user_sessions` |
| `users` | Account tab (`PUT /settings/profile`) | READ, UPDATE | Admin, Staff | Change fullname/email; username only if admin | `audit_logs` |
| `users` | Account tab (`POST /settings/profile-image`) | UPDATE | Admin, Staff | Store avatar as a base64 data URI | — |
| `users` | Security tab (`PUT /settings/password`) | READ, UPDATE | Admin, Staff | Verify current password, write new bcrypt hash | `audit_logs` |
| `users` | Users tab (`GET/POST/PUT /settings/staff`) | CREATE, READ, UPDATE | **Admin only** | List, create and edit accounts. Creation emails a generated password | `audit_logs` |
| `users` | Users tab (`POST /settings/staff/<id>/toggle`) | READ, UPDATE | **Admin only** | Enable/disable an account. Cannot target self | `audit_logs` |
| `users` | Reset password (`POST /api/v1/auth/reset-password`) | READ, UPDATE | Anonymous (holding token) | Set new password from a valid reset token | `password_resets`, `otp_codes` |
| `users` | — | **DELETE** | **Nobody** | **No endpoint deletes a user.** Deactivation via `active = 0` is the only removal path | — |
| `inventory` | Counter (`POST /save_inventory`) | CREATE | Admin, Staff | Commit a counted batch as stock in | `counting_sessions` |
| `inventory` | Inventory tab (`GET /get_inventory`) | READ | **Admin only** (tab) | Paginated, filtered movement list | — |
| `inventory` | Adjustments (`POST /adjust_stock_batch`) | READ, CREATE | **Admin only** (tab) | Record `SOLD` / `DIED` / `WHOLESALE_IN`; validates stock under `FOR UPDATE` | — |
| `inventory` | Inventory tab (`DELETE /delete_inventory/<id>`) | READ, UPDATE | **Admin only** (tab) | Archive a row — `is_archived = 1`; stock unaffected | — |
| `inventory` | Counter (`POST /undo_save/<id>`) | READ, UPDATE | Admin, Staff | True reversal — `deleted = 1`, within 120 s | `counting_sessions` |
| `inventory` | Archive view (`POST /restore_record/<id>`) | READ, UPDATE | **Admin only** (tab) | Un-archive | — |
| `inventory` | Dashboard (`GET /get_statistics`) | READ | **Admin only** (tab) | ~15 aggregate queries: stock, revenue, trends | — |
| `inventory` | Reports (`GET /api/reports/data`) | READ | **Admin only** | Raw rows for a date range; grouped in the browser | `counting_sessions` |
| `inventory` | — | **DELETE** | **Nobody** | **No `DELETE FROM inventory` exists.** Both removal paths are flag updates | — |
| `counting_sessions` | Counter (`GET /start`) | CREATE, UPDATE | Admin, Staff | Open a run; mark any stale `active` row `aborted` | `devices`, `users` |
| `counting_sessions` | Counter (`GET /stop`) | UPDATE | Admin, Staff | Close the run as `completed` or `aborted` | — |
| `counting_sessions` | Counter (`POST /save_inventory`) | UPDATE | Admin, Staff | Link run to the inventory row it produced | `inventory` |
| `counting_sessions` | Dashboard (`GET /api/sessions`) | READ | **Admin only** (tab) | "Recent Sessions" list | — |
| `counting_state` | App startup | READ, UPDATE | System (no user) | Clear a flag left set by a crash | — |
| `counting_state` | Counter (`GET /start`, `/stop`, `/get_state`) | READ, UPDATE | Admin, Staff | The shared start/stop flag, locked `FOR UPDATE` | `counting_sessions` |
| `devices` | Registration (`POST /api/v1/devices/register`) | CREATE | **Admin only** | Register hardware; return the token once | — |
| `devices` | Device list (`GET /api/v1/devices`) | READ | **Admin only** | List units without secrets | — |
| `devices` | Revoke/activate | UPDATE | **Admin only** | Flip `active` | — |
| `devices` | Ingest (`POST /api/v1/ingest`) | READ, UPDATE | **Counter device** | Verify token hash; stamp `last_seen` | `readings` |
| `devices` | Locks (`POST .../lock`, `.../unlock`) | READ, UPDATE | Admin, Staff | Take/release the kiosk reservation | — |
| `readings` | Ingest (`POST /api/v1/ingest`) | **CREATE only** | **Counter device** | Append raw telemetry | `devices` |
| `readings` | — | READ / UPDATE / DELETE | **Nobody** | **Never read back by any code** | — |
| `feed_purchases` | Feed tab (`GET /api/v1/feed/purchases`, `/status`) | READ | **Admin only** | History plus the recomputed countdown | — |
| `feed_purchases` | Feed tab (`POST /api/v1/feed/purchases`) | CREATE | **Admin only** | Record a delivery | `audit_logs` |
| `feed_purchases` | Feed tab (`PUT .../<id>`) | READ, UPDATE | **Admin only** | Correct a purchase | `audit_logs` |
| `feed_purchases` | Feed tab (`DELETE .../<id>`) | READ, UPDATE | **Admin only** | Soft delete — `deleted = 1` | `audit_logs` |
| `otp_codes` | Login | CREATE, UPDATE | Anonymous | Issue a code; retire any unused ones | `users` |
| `otp_codes` | Verify / Resend | READ, UPDATE | Anonymous | Compare hashes; count attempts; throttle | `users` |
| `password_resets` | Forgot password | READ, CREATE | Anonymous | Rate-limit by email, then store the token hash | `users` |
| `password_resets` | Validate / Reset | READ, UPDATE | Anonymous | Check validity; mark single-use | `users` |
| `user_sessions` | Verify OTP | CREATE | Anonymous | Record the new session under its `jti` | `users` |
| `user_sessions` | Every authenticated request | READ | Admin, Staff | Reject a revoked `jti` | `users` |
| `user_sessions` | Security tab | READ, UPDATE | Admin, Staff | List own sessions; revoke one; log out all others | `audit_logs`, `users` |
| `login_history` | Login (failure path) | CREATE | Anonymous | Record a failed attempt | `users` |
| `login_history` | Verify OTP (success) | CREATE | Anonymous | Record a successful sign-in | `users` |
| `login_history` | Login (lockout check) | READ | Anonymous | Count failures newer than the last success | `users` |
| `login_history` | Security tab | READ | Admin, Staff | Paginated own history | — |
| `notification_prefs` | Notifications tab | READ, CREATE, UPDATE | Admin, Staff | Read-or-default, then upsert | `users` |
| `audit_logs` | All admin write paths | CREATE | Admin (mostly) | Record the action; failure is swallowed so it cannot break the response | `users` |
| `audit_logs` | Security tab | READ | Admin, Staff | Own last 20 events | — |
| `audit_logs` | System tab (`GET /settings/audit-logs`) | READ | **Admin only** | All users' entries, `LEFT JOIN users` for the name | `users` |

---

## 5. ERD Relationships

Relationships were established **only** from declared foreign keys, real JOIN statements,
and named backend logic. No relationship below is inferred from column-name similarity
alone.

### 5a. Enforced relationships — real foreign keys

[CONFIRMED — read from `information_schema.KEY_COLUMN_USAGE`. These five, and only these
five, exist in the database.]

| Parent Table | Parent Column | Child Table | Child Column | Relationship | Explanation |
| ------------ | ------------- | ----------- | ------------ | ------------ | ----------- |
| `users` | `id` | `user_sessions` | `user_id` | **1:M** (CASCADE) | One user may be signed in on many devices at once. Created at [auth_otp.py:671](backend/api/auth_otp.py#L671); listed and revoked in the Security tab. Cascade is correct — a deleted user's sessions must not outlive them. |
| `users` | `id` | `login_history` | `user_id` | **1:M** (CASCADE) | One user accumulates many sign-in attempts. Written on both success and failure; read by the Security tab **and by the lockout rule** at [auth_otp.py:301](backend/api/auth_otp.py#L301). |
| `users` | `id` | `notification_prefs` | `user_id` | **1:1** (CASCADE, **UNIQUE**) | The UNIQUE index on `user_id` makes this one-to-one. The upsert at [settings.py:426](backend/api/settings.py#L426) checks for an existing row before inserting, matching the constraint. |
| `users` | `id` | `audit_logs` | `user_id` | **1:M** (**SET NULL**) | One user performs many auditable actions. `SET NULL` rather than cascade is deliberate: the audit trail must survive the deletion of the person who acted. Joined at [settings.py:808](backend/api/settings.py#L808) with a `LEFT JOIN` — which is required, precisely because `user_id` can be NULL. |
| `devices` | `id` | `readings` | `device_id` | **1:M** (CASCADE) | One device emits many readings. Written with the **verified** device id at [ingest.py:44](backend/api/ingest.py#L44). The only enforced relationship not involving `users`. |

### 5b. Logical relationships — real, used, but **not** enforced by a constraint

[CONFIRMED from code. These behave as relationships in the application but the database
does not police them. For a thesis ERD they should be drawn, and the distinction noted.]

| Parent Table | Parent Column | Child Table | Child Column | Relationship | Explanation |
| ------------ | ------------- | ----------- | ------------ | ------------ | ----------- |
| `users` | `id` | `otp_codes` | `user_id` | **1:M** (no FK) | One user may be issued many codes over time. Every query filters on `user_id`, so it is a real relationship; the missing constraint is documented at `database/schema.sql:156` as a preserved quirk of how the live database was built. |
| `users` | `id` | `counting_sessions` | `user_id` | **1:M** (no FK) | One user runs many counting sessions. Written from the JWT at [counting.py:428](backend/api/counting.py#L428). Left unconstrained **on purpose**, together with the denormalised `username`, so session history survives a user being removed. |
| `devices` | `id` | `counting_sessions` | `device_id` | **1:M** (no FK) | One device hosts many sessions. Written from the `DEVICE_ID` environment variable, not from a lookup — so an unregistered id can be recorded. |
| `inventory` | `id` | `counting_sessions` | `inventory_id` | **1:1, optional** (no FK) | A saved session points at the one inventory row it produced. Set at [inventory.py:237](backend/api/inventory.py#L237), cleared on undo. Currently NULL in every live row — see Section 12. |
| `users` | `id` | `devices` | `locked_by` | **1:M, optional** (no FK, **type mismatch**) | The user currently holding a device's kiosk lock. Written as a string into a `char(36)` column ([locks.py:67](backend/api/locks.py#L67)) although `users.id` is `bigint unsigned` — a foreign key could not be added without changing the column type. |
| `users` | `email` | `password_resets` | `email` | **1:M, weak** (no FK, non-unique on both sides) | Reset requests for an address. Matched by email string at [auth_otp.py:1077](backend/api/auth_otp.py#L1077). This is **not a proper relationship** — `users.email` is not unique at the database level, and rows are deliberately written for addresses with no account. Best drawn as a dashed association, or left out. |

### 5c. Relationships that do **not** exist

Stated explicitly so they are not drawn by mistake:

- **`inventory` has no relationship to `users`.** No `created_by` column exists. **Nothing
  in the schema records who made a stock movement.** The only trace is the `username` on
  the counting session, and only for counted batches — not for sales or deaths.
- **`inventory` has no relationship to `devices`.** `planned_schema.sql:116` shows a
  `device_id` column was designed for it and never deployed.
- **`readings` has no relationship to `inventory`.** Raw counts never become stock rows
  directly; the operator must press Save, which reads an **in-memory** counter, not the
  `readings` table.
- **`counting_state` has no relationship to anything.** It is a standalone singleton.
- **There is no M:N relationship anywhere in this schema, and therefore no junction
  table.** [CONFIRMED — all five foreign keys are single-column references to a primary
  key, and no table has a composite primary key.]

---

## 6. ERD Cardinality

### Notation

```
A 1 ────< B     One A relates to many B  (1:M)
A 1 ────1 B     One A relates to exactly one B  (1:1)
────            Solid: enforced by a FOREIGN KEY
- - -           Dashed: enforced only by application code
```

### Enforced

```
users 1 ────< user_sessions
```
One user can hold many active sessions; each session belongs to exactly one user.
*Reasoning:* `user_id` is NOT NULL with a FK, and carries a **non-unique** index — many
rows per user are structurally permitted, and 18 live rows across 3 users confirm it.
**Participation:** users optional (a user who never signed in has none); sessions
mandatory.

```
users 1 ────< login_history
```
One user accumulates many attempts; each attempt belongs to one user.
*Reasoning:* NOT NULL FK, non-unique composite index `(user_id, login_time)`.
**Participation:** users optional; history mandatory.

```
users 1 ────1 notification_prefs
```
One user has at most one preference row.
*Reasoning:* **this is 1:1 solely because of the UNIQUE index on `user_id`.** Remove that
index and it becomes 1:M. This is the only 1:1 in the schema enforced by the database.
**Participation:** users optional — and in this installation, **no** user has a row.

```
users 1 ────< audit_logs
```
One user performs many auditable actions.
*Reasoning:* non-unique index, and `user_id` is **NULLABLE** — unusually for a child
column, because `ON DELETE SET NULL` requires it.
**Participation:** users optional; audit entries **optional on the parent side too** — an
orphaned entry with `user_id = NULL` is valid and is displayed as `'system'`.

```
devices 1 ────< readings
```
One device emits many readings; each reading came from exactly one device.
*Reasoning:* NOT NULL FK, composite index `(device_id, timestamp)`. 53 live rows from 1
device.
**Participation:** devices optional; readings mandatory.

### Logical (application-enforced)

```
users    1 - - -< otp_codes            (36 live rows; user_id NOT NULL but unconstrained)
users    1 - - -< counting_sessions    (user_id NULLABLE — an anonymous session is valid)
devices  1 - - -< counting_sessions    (device_id NULLABLE)
inventory 1 - - -1 counting_sessions   (optional on both sides; currently never populated)
users    1 - - -< devices.locked_by    (at most one lock per device at a time)
users    1 - - -< password_resets      (weak, by email string — see 5b)
```

### Constraint summary

**Primary keys.** Every table has exactly one, single-column. Twelve are auto-increment
integers. The exception is `devices.id`, a `varchar(255)` UUID — a **natural key**. A
second exception in spirit is `counting_state.id`, an integer with **no** auto-increment,
which is what enforces the singleton.

**Unique constraints** [CONFIRMED — only three exist]:
- `users.username`
- `user_sessions.session_token`
- `notification_prefs.user_id` ← the one that creates the only 1:1 relationship

Note what is **not** unique: `users.email`. Uniqueness is checked in application code
([settings.py:181](backend/api/settings.py#L181)) but not by the database, so two rows
could hold the same address if a row were inserted outside the app.

**Required (NOT NULL) versus optional** — the pattern across the schema:
- Identity and integrity columns are NOT NULL: all PKs, `users.username`,
  `users.password_hash`, `devices.secret_hash`, `inventory.count`, `inventory.variant`,
  `inventory.date`.
- Descriptive and contact columns are nullable: `users.email`, `users.fullname`,
  `devices.location`, `devices.model`, all `notes` columns.
- Lifecycle flags are NOT NULL with a default, so they are never ambiguous:
  `inventory.is_archived`, `feed_purchases.deleted`, `user_sessions.is_active`,
  `otp_codes.used`.

**Junction tables: none.** There is no M:N relationship in this schema.

---

## 7. Level 1 DFD — External Entities

Only entities that genuinely interact with the system. [CONFIRMED from route decorators,
`App.jsx` tab sets, and the vision process.]

| # | External Entity | Who/What It Is | What It Sends In | What It Receives Back |
| - | --------------- | -------------- | ---------------- | --------------------- |
| **E1** | **Admin** | Farm owner/manager. Role `admin`. Reaches all seven tabs: dashboard, counter, inventory, adjustments, feed, reports, settings ([App.jsx:23](frontend/src/App.jsx#L23)). | Credentials, OTP code, stock adjustments, feed purchases, staff account details, device registrations, report date ranges | JWT, dashboard statistics, inventory lists, reports and exports, audit logs, device tokens, feed countdown |
| **E2** | **Staff** | Counter operator. Role `staff`. Reaches **only** counter and settings ([App.jsx:24](frontend/src/App.jsx#L24)). | Credentials, OTP code, start/stop commands, counted batch to save, own profile and password changes | JWT, live count, session state, own login history and sessions |
| **E3** | **Fish Counter Device** | The Raspberry Pi 5 vision process, [vision/fish_counter.py](vision/fish_counter.py). A **separate OS process**, authenticating as a machine with a bearer device token — not a logged-in person. | `POST /api/v1/ingest` carrying `device_id`, `count`, `firmware`, `rssi` and a bearer token ([fish_counter.py:747](vision/fish_counter.py#L747)) | HTTP 201 acknowledgement with the verified device id and accepted count |
| **E4** | **SMTP Email Service** | External Gmail SMTP relay (`smtp.gmail.com:587`). | Delivery success or SMTP failure | Outbound OTP codes, password-reset links, new-account credentials ([auth_otp.py:138](backend/api/auth_otp.py#L138), [settings.py:648](backend/api/settings.py#L648)) |

**Why Admin and Staff are separate entities.** They are not one "User" box. Their tab
sets differ, ten endpoints are gated by `require_admin`, and the two roles trigger
genuinely different processes. Merging them would hide the authorisation boundary that
`require_admin` creates — exactly the sort of thing a panel asks about.

---

## 8. Level 1 DFD — Processes

Eight processes, each corresponding to a registered Flask blueprint
([backend/app.py:56](backend/app.py#L56)). These are the real modules, not a generic list.

| # | Process | Implementation | What It Does |
| - | ------- | -------------- | ------------ |
| **1.0** | **Authenticate User** | [backend/api/auth_otp.py](backend/api/auth_otp.py) | Two-step login: password, then an emailed OTP. Issues JWTs, enforces lockout after 5 failures in 15 minutes, handles password reset, and validates every subsequent request. |
| **2.0** | **Control Counting Session** | [backend/api/counting.py](backend/api/counting.py) | Starts and stops the vision process as an OS subprocess, maintains the shared start/stop flag, and opens/closes session records. |
| **3.0** | **Ingest Fish Count** | [backend/api/ingest.py](backend/api/ingest.py) | Authenticates the device by bcrypt token, stores the raw reading, stamps `last_seen`, and broadcasts the count over Socket.IO. |
| **4.0** | **Manage Devices & Locks** | [backend/api/devices.py](backend/api/devices.py), [backend/api/locks.py](backend/api/locks.py) | Registers hardware and issues tokens; revokes and reactivates; holds a 3-minute kiosk reservation so two operators cannot drive one counter. |
| **5.0** | **Manage Inventory** | [backend/api/inventory.py](backend/api/inventory.py) | Saves counted batches, records sales and deaths with stock validation under `FOR UPDATE`, archives, restores, and undoes. |
| **6.0** | **Manage Feed Purchases** | [backend/api/feed.py](backend/api/feed.py) | Records feed deliveries and recomputes the next-purchase countdown on every read. |
| **7.0** | **Generate Reports & Dashboard** | [backend/api/reports.py](backend/api/reports.py), `inventory.get_statistics` | Aggregates the ledger into stock levels, revenue, trends and exportable reports. Read-only. |
| **8.0** | **Administer Users & System** | [backend/api/settings.py](backend/api/settings.py) | Profiles, passwords, staff accounts, notification preferences, session management, audit log and system health. |

**Processes deliberately not listed.** There is no "Notification Management" process:
notification *preferences* are stored (process 8.0) but nothing consumes them, and the
delivery-side `notifications` table was never built (`planned_schema.sql:107`). Drawing
such a process would be inventing functionality.

---

## 9. Level 1 DFD — Data Stores

Thirteen tables grouped into eight logical stores. Every table appears in **exactly one**
store — no table is omitted and none is counted twice.

| Store | Name | Tables | Why grouped this way |
| ----- | ---- | ------ | -------------------- |
| **D1** | User Accounts & Preferences | `users`, `notification_prefs` | `notification_prefs` is 1:1 with `users` and holds nothing but per-user settings — logically part of the account record, split out only for schema tidiness. |
| **D2** | Authentication Credentials | `otp_codes`, `password_resets`, `user_sessions` | All three hold short-lived, hashed credential material with an expiry or a revocation flag. All three are written and read only by process 1.0. |
| **D3** | Activity Log | `login_history`, `audit_logs` | Both are append-only trails of who did what, when, and from which IP. Both feed the Security tab. |
| **D4** | Device Registry | `devices` | Machine identity plus the kiosk lock. |
| **D5** | Sensor Readings | `readings` | Raw telemetry, kept separate because it is the only store written by a non-human entity. |
| **D6** | Counting Control | `counting_state`, `counting_sessions` | The live flag and the historical record of runs — the transient and durable halves of the same concern. |
| **D7** | Inventory Ledger | `inventory` | The business ledger. Kept alone because it is the source of every reported figure. |
| **D8** | Feed Purchases | `feed_purchases` | Independent of stock; feeds only the countdown alert. |

**Check:** 2 + 3 + 2 + 1 + 1 + 2 + 1 + 1 = **13 tables.** ✅

---

## 10. Level 1 DFD — Data Flows

### 10a. Process-by-process flow table

| Process No. | Process Name | Input | Source | Database/Data Store | Output | Destination |
| ----------- | ------------ | ----- | ------ | ------------------- | ------ | ----------- |
| 1.0 | Authenticate User | username + password | E1 Admin / E2 Staff | D1 (read user), D3 (write attempt), D2 (write OTP) | OTP handle + masked email hint | E1 / E2 |
| 1.0 | Authenticate User | OTP send request | internal | — | OTP code email | E4 SMTP |
| 1.0 | Authenticate User | 6-digit OTP + handle | E1 / E2 | D2 (read/consume OTP, write session), D1 (set `last_login`), D3 (write success) | **JWT token** + user identity | E1 / E2 |
| 1.0 | Authenticate User | email address | E1 / E2 | D2 (rate-limit check, write token hash) | reset link email | E4 SMTP |
| 1.0 | Authenticate User | reset token + new password | E1 / E2 | D2 (consume token), D1 (write hash) | confirmation | E1 / E2 |
| 1.0 | Authenticate User | Bearer JWT (every request) | E1 / E2 | D1 (read `sessions_invalidated_at`), D2 (read `is_active`) | allow or 401 | all processes |
| 2.0 | Control Counting Session | start command + variant | E1 / E2 | D6 (lock + set `active=1`, open session), D4 (read device name) | started acknowledgement + Socket.IO broadcast | E1 / E2 |
| 2.0 | Control Counting Session | stop command | E1 / E2 | D6 (set `active=0`, close session with final count) | stopped acknowledgement + broadcast | E1 / E2 |
| 2.0 | Control Counting Session | state poll | E1 / E2 | D6 (read flag + active session) | active flag, device, session | E1 / E2 |
| 2.0 | Control Counting Session | *(spawn)* | internal | — | OS subprocess launch | E3 Device |
| 3.0 | Ingest Fish Count | count + device_id + token | **E3 Device** | D4 (verify `secret_hash`, stamp `last_seen`), D5 (append reading) | 201 ACK; live count broadcast | E3 Device; E1 / E2 |
| 4.0 | Manage Devices & Locks | registration details | E1 Admin | D4 (write device + token hash) | **device id + plaintext token, shown once** | E1 Admin |
| 4.0 | Manage Devices & Locks | revoke / activate | E1 Admin | D4 (set `active`) | status | E1 Admin |
| 4.0 | Manage Devices & Locks | lock / unlock request | E1 / E2 | D4 (read + write `locked_by`, `lock_time`) | lock granted, or 423 held by another | E1 / E2 |
| 5.0 | Manage Inventory | counted batch (count, variant, notes) | E1 / E2 | D7 (insert movement), D6 (mark session `saved`) | new record id, for undo | E1 / E2 |
| 5.0 | Manage Inventory | adjustment (type, items, price) | E1 Admin | D7 (read stock `FOR UPDATE`, insert signed movement) | success, or insufficient-stock error | E1 Admin |
| 5.0 | Manage Inventory | archive / restore / undo | E1 / E2 | D7 (set `is_archived` or `deleted`), D6 (unlink on undo) | confirmation | E1 / E2 |
| 5.0 | Manage Inventory | list request + filters | E1 Admin | D7 (paginated read) | movement list | E1 Admin |
| 6.0 | Manage Feed Purchases | purchase (date, amount, notes) | E1 Admin | D8 (insert), D3 (audit entry) | saved purchase **+ recomputed countdown** | E1 Admin |
| 6.0 | Manage Feed Purchases | edit / delete | E1 Admin | D8 (update or soft-delete), D3 (audit entry) | updated countdown | E1 Admin |
| 6.0 | Manage Feed Purchases | status request | E1 Admin | D8 (read latest by `purchased_on`) | days remaining, status, cycles missed | E1 Admin |
| 7.0 | Generate Reports & Dashboard | statistics request + filters | E1 Admin | D7 (≈15 aggregate reads) | stock, revenue, trends, recent movements | E1 Admin |
| 7.0 | Generate Reports & Dashboard | report date range | E1 Admin | D7 (rows in range), D6 (sessions in range) | report payload; Excel/PDF built in browser | E1 Admin |
| 8.0 | Administer Users & System | profile / password change | E1 / E2 | D1 (update user), D3 (audit entry) | confirmation | E1 / E2 |
| 8.0 | Administer Users & System | new staff account | E1 Admin | D1 (insert user), D3 (audit entry) | account created | E1 Admin |
| 8.0 | Administer Users & System | *(credentials)* | internal | — | generated password email | E4 SMTP |
| 8.0 | Administer Users & System | notification toggles | E1 / E2 | D1 (upsert prefs) | saved | E1 / E2 |
| 8.0 | Administer Users & System | session revoke / logout-all | E1 / E2 | D2 (deactivate sessions), D1 (set invalidation), D3 (audit) | confirmation | E1 / E2 |
| 8.0 | Administer Users & System | audit log / system status request | E1 Admin | D3 (read + join D1), D1 (counts) | audit entries, DB size, uptime | E1 Admin |

### 10b. Flows that cross process boundaries

Worth drawing, because they are what makes the diagram a *system* rather than eight
independent programs:

- **1.0 → every other process.** No process except 3.0 is reachable without a valid JWT.
  Every `@require_auth` route depends on process 1.0 having run.
- **2.0 → E3 (control, not data).** Process 2.0 *launches and kills the device process*
  with `subprocess.Popen` ([counting.py:257](backend/api/counting.py#L257)). This is a
  control flow to an external entity, which is unusual and worth labelling explicitly.
- **3.0 → 5.0, via memory, not via a data store.** [CONFIRMED and important.] The
  ingested count goes into an **in-process variable**
  (`runtime.fish_count`, [ingest.py:58](backend/api/ingest.py#L58)); when the operator
  presses Save, process 5.0 reads *that variable*, **not** the `readings` table
  ([inventory.py:198](backend/api/inventory.py#L198)). **Do not draw an arrow from D5 to
  process 5.0** — it does not exist. This is why `readings` accumulates unread.
- **5.0 ↔ 2.0.** Saving an inventory row updates the session's status and link.
- **6.0 and 8.0 → D3.** Both write audit entries.

---

## 11. ERD-to-DFD Mapping

The consistency bridge between the two diagrams.

| Database Table | DFD Data Store | Used By Process | Input/Output | Purpose |
| -------------- | -------------- | --------------- | ------------ | ------- |
| `users` | D1 | 1.0, 8.0 | Both | Identity, credentials, role |
| `notification_prefs` | D1 | 8.0 | Both | Per-user notification toggles |
| `otp_codes` | D2 | 1.0 | Both | Second-factor login codes |
| `password_resets` | D2 | 1.0 | Both | Reset tokens, rate limiting |
| `user_sessions` | D2 | 1.0, 8.0 | Both | Active-session tracking and revocation |
| `login_history` | D3 | 1.0, 8.0 | Both | Sign-in attempts **and lockout counting** |
| `audit_logs` | D3 | 6.0, 8.0 | Both (write-heavy) | Administrative action trail |
| `devices` | D4 | 2.0, 3.0, 4.0 | Both | Machine identity and kiosk lock |
| `readings` | D5 | 3.0 | **Output only** | Raw telemetry — written, never read |
| `counting_state` | D6 | 2.0 | Both | Shared start/stop flag |
| `counting_sessions` | D6 | 2.0, 5.0, 7.0 | Both | Historical record of counting runs |
| `inventory` | D7 | 5.0, 7.0 | Both | The business ledger |
| `feed_purchases` | D8 | 6.0 | Both | Feed delivery records |

**Reverse check — every process touches at least one store:**

| Process | Stores touched |
| ------- | -------------- |
| 1.0 Authenticate | D1, D2, D3 |
| 2.0 Counting Session | D4 (read), D6 |
| 3.0 Ingest | D4, D5 |
| 4.0 Devices & Locks | D4 |
| 5.0 Inventory | D6, D7 |
| 6.0 Feed | D3, D8 |
| 7.0 Reports | D6 (read), D7 (read) |
| 8.0 Administration | D1, D2, D3 |

All eight stores appear; all eight processes appear. ✅

---

## 12. Unused / Unclear Database Elements

Every finding below was checked against **both** the source code and the live data. This
is analysis only — nothing was modified.

| Element | Type | Evidence | Problem/Observation | Recommendation |
| ------- | ---- | -------- | ------------------- | -------------- |
| `counting_sessions` (table) | **Schema drift** | Live in the database with 11 rows. Absent from `database/schema.sql`, which states it matches the live DB "table for table" and ends "12 tables". Created only by `init_db()` ([db.py:197](backend/core/db.py#L197)) and `migrations/add_counting_sessions.sql`. | A fresh install run from `schema.sql` alone produces a database missing a table the code actively writes. The app survives because `init_db()` creates it on first start — but the documented source of truth is wrong. | Fold the migration into `schema.sql` and correct the "12 tables" comment. **Your ERD must include this table** — it is real. |
| `readings` (table) | **Write-only** | `grep -i "from readings"` matches nothing in `backend/`, `frontend/`, `vision/` or `scripts/`. Only the `INSERT` at [ingest.py:44](backend/api/ingest.py#L44). 53 live rows. | The table accumulates data no feature ever reads. The live count reaches the UI over Socket.IO, and Save reads an in-memory variable. | Keep it — it is a legitimate audit trail and costs little. But **draw it as output-only in your DFD**, and be ready to say so: a panel will ask what reads it. |
| `users.failed_attempts` | **Dead column (never written)** | Returned by [settings.py:141](backend/api/settings.py#L141). No `UPDATE` anywhere sets it. Live: 0 of 3 rows non-zero. Actual lockout counts `login_history` rows ([auth_otp.py:301](backend/api/auth_otp.py#L301)). | The column implies a counter the system does not maintain. It will always read 0 in the UI, which is misleading. | Document it as superseded by `login_history`. Do **not** present it as the lockout mechanism in your defence. |
| `inventory.price`, `inventory.total_price` | **Written, never used in calculation** | Written at [inventory.py:1387](backend/api/inventory.py#L1387); 186 live rows populated. But **every** revenue figure multiplies by the `PRICE_PER_FISH` constant ([inventory.py:14](backend/api/inventory.py#L14)). | **The most significant finding here.** Price now lives in three places: the `price` column, the backend env constant, and a *third* hardcoded copy at [Inventory.jsx:16](frontend/src/components/Inventory.jsx#L16). A sale recorded at ₱0.50 still reports revenue at ₱0.40. | Analysis only, so no change made. But know the answer if asked "where does revenue come from?" — it is the constant, not the stored price. |
| `audit_logs.object_id` | **Written, never read** | Written by `_log_audit` ([settings.py:81](backend/api/settings.py#L81)); 33 live rows populated. `get_audit_logs` ([settings.py:805](backend/api/settings.py#L805)) does not select it. | The value cannot reach the UI. `schema.sql:247` acknowledges this, calling it retained "for forensic traceability" — a fair justification. | Keep. Describe it as forensic-only, not a UI field. |
| `counting_sessions.inventory_id` | **Never populated** | 0 of 11 live rows have a value. The linking `UPDATE` ([inventory.py:237](backend/api/inventory.py#L237)) requires `status='completed' AND inventory_id IS NULL`; live statuses are 12 `aborted`, 1 `completed`, 0 `saved`. | The session→inventory link is implemented on both sides but has never fired in this installation. The `'saved'` status is likewise never reached. | Draw the relationship (the code is real), but mark it **optional**. Say plainly that no live row exercises it. |
| `notification_prefs` (table) | **Implemented, never populated** | 0 live rows. GET returns hardcoded defaults when absent ([settings.py:390](backend/api/settings.py#L390)). | The UI shows all toggles on and saving appears to work, but no row has ever been written here. Separately, **no code consumes these flags** — no email path checks them. | Include in the ERD (it is deployed, with a real FK). Be honest that delivery is not implemented. |
| `inventory.transaction_type` default | **Invalid default value** | Column default is `'TANK_IN'`. `VALID_TRANSACTION_TYPES` is `{SOLD, DIED, WHOLESALE_IN}` ([inventory.py:33](backend/api/inventory.py#L33)) — `TANK_IN` is not among them. | An insert that omits the column silently produces a value the application rejects. No live row has it, because every code path sets it explicitly. | Note as legacy residue from the removed retail/tank model. |
| `inventory.action` values `IN` / `OUT` | **Dead query branch** | `get_statistics` computes `tank_total` from `action='IN' OR action='OUT'` ([inventory.py:535](backend/api/inventory.py#L535)). Live data: **zero** such rows — all 199 are `WHOLESALE`. | The "Fish in Tank" metric structurally returns 0/NULL. It is a leftover from the retail model, removed when the farm went wholesale-only. | Do not feature "Fish in Tank" as a working metric. `tank_total` is dead against current data. |
| `otp_codes.user_id` | **Missing FK** | No constraint, unlike every other user-owned table. `schema.sql:156` records this as intentional preservation. | An OTP row can outlive its user; deleting a user leaves orphans. Low practical risk — no endpoint deletes users. | Draw as a **dashed** (logical) relationship. |
| `devices.locked_by` | **Missing FK + type mismatch** | `char(36)` holding a `users.id`, written as a string at [locks.py:67](backend/api/locks.py#L67). `users.id` is `bigint unsigned`. | A foreign key cannot be added without changing the column type. The `char(36)` width suggests it was designed for a UUID, not an integer id. | Draw as a dashed relationship; mention the type mismatch if asked why there is no FK. |
| `password_resets.email` | **Weak link, by design** | Matched by email string ([auth_otp.py:1077](backend/api/auth_otp.py#L1077)). `users.email` is **not** unique in the database. Rows are written for non-existent addresses on purpose. | Not a true relationship. But it is a deliberate anti-enumeration measure, not an oversight. | Draw dashed, or omit and explain. The design reason is defensible. |
| `inventory` — no owner column | **Missing traceability** | No `created_by`, `user_id` or `device_id` column exists. Confirmed against the live column list. | **Nothing records who made a stock movement.** A sale or a recorded death is untraceable to a person. `planned_schema.sql:116` shows a `device_id` was designed and never deployed. | Expect this question. The honest answer: attribution exists only for counting sessions, via the denormalised `username`. |
| 8 tables in `planned_schema.sql` | **Designed, never built** | `suppliers`, `purchase_orders`, `purchase_items`, `ota_tasks`, `calibrations`, `notifications`, `roles`, `user_roles` — all fully commented out, none deployed. | Correctly kept out of the runnable schema. `roles`/`user_roles` are explicitly marked superseded by the `role` column. | **Do not put any of these in your ERD.** If you want to show them, use a clearly separated "future work" diagram. |
| `docs/DFD.html` | **Stale documentation** | Documents 6 data stores and 5 processes; the live database has 13 tables and the code has 8 processes. Models inventory as tank `IN`/`OUT`, which no live row uses. | Missing entirely: `counting_sessions`, `feed_purchases`, `user_sessions`, `login_history`, `notification_prefs`, `audit_logs`, `password_resets`. | **Do not submit the existing DFD.** Build the new one from Section 15. (Left unmodified as you instructed.) |
| Collation inconsistency | **Cosmetic** | `counting_state`, `counting_sessions`, `inventory`, `otp_codes` are `utf8mb4_unicode_ci`; the other nine are `utf8mb4_general_ci`. | Harmless: no query JOINs two tables on a string column, so no collation conflict can arise. `schema.sql:270` states this reasoning. | Leave alone. Mention only if asked. |

---

## 13. ERD–DFD Consistency Check

### ERD

| Check | Result |
| ----- | ------ |
| All important tables included? | ✅ All 13 live tables. **Including `counting_sessions`**, which `schema.sql` omits. |
| Primary keys correct? | ✅ 13 single-column PKs, verified against `information_schema`. Note the two irregular ones: `devices.id` (varchar UUID) and `counting_state.id` (no auto-increment). |
| Foreign keys correct? | ✅ Exactly 5 enforced FKs. A further 6 logical references are drawn separately as dashed lines. Claiming 11 FKs would be wrong; claiming 5 relationships would be incomplete. |
| Relationships supported by the database? | ✅ The 5 solid lines are declared constraints. The 6 dashed lines each cite the code line that maintains them. |
| Cardinalities reasonable? | ✅ Each is justified by a constraint *and* by live row counts. The single 1:1 rests entirely on the UNIQUE index on `notification_prefs.user_id`. |
| M:N relationships / junction tables? | ✅ **None exist.** No composite PKs, no join tables. |

### Level 1 DFD

| Check | Result |
| ----- | ------ |
| All major processes represented? | ✅ All 8 correspond to registered blueprints ([app.py:56](backend/app.py#L56)). |
| External entities represented? | ✅ 4. Admin and Staff kept separate because `require_admin` gates 10 endpoints. |
| Data stores logical? | ✅ 8 stores covering all 13 tables, each table in exactly one. |
| Inputs and outputs represented? | ✅ Including the machine input from E3 and the outbound email to E4, both easy to omit. |
| Data flows logically connected? | ✅ Every process reads or writes at least one store; every store is touched by at least one process. |

### Cross-check: ERD tables → DFD stores → processes → entities

```
13 tables  →  8 data stores  →  8 processes  →  4 external entities
```

Traced end to end, no orphans in either direction:

- Every table in Section 2 appears in exactly one store in Section 9. ✅
- Every store in Section 9 is read or written by at least one process in Section 11. ✅
- Every process in Section 8 exchanges data with at least one external entity. ✅
- Every external entity in Section 7 triggers at least one process. ✅

### Things a professor is likely to question — and the honest answer

1. **"Why does `counting_sessions` have three reference columns and no foreign keys?"**
   Deliberate. `username` is denormalised so history survives a user being renamed or
   deleted (`add_counting_sessions.sql:9`). Adding FKs would defeat that.

2. **"Where is the junction table?"** There is none, because there is no M:N
   relationship. Say so plainly rather than inventing one.

3. **"Why is `readings` in the DFD if nothing reads it?"** Because process 3.0 genuinely
   writes to it. Draw a one-way arrow in and no arrow out — and volunteer the explanation
   before you are asked.

4. **"Who made this stock movement?"** The schema does not record it. Attribution exists
   only for counting sessions. This is a real limitation; do not claim otherwise.

5. **"Why are Admin and Staff separate entities?"** Different tab sets
   ([App.jsx:23–24](frontend/src/App.jsx#L23)) and ten admin-gated endpoints.

6. **"Your DFD shows no arrow from `readings` to Manage Inventory — how does a count
   become stock?"** Through an in-process variable, not the database
   ([ingest.py:58](backend/api/ingest.py#L58) writes it,
   [inventory.py:198](backend/api/inventory.py#L198) reads it). This is the single most
   likely question about the diagram; the honest answer is also the interesting one.

7. **"Is `price` used to compute revenue?"** No. Revenue uses a configured constant.
   See Section 12.

---

## 14. Final ERD Structure

```text
USERS
- PK: id (bigint unsigned, auto)
- UNIQUE: username
- Notable: role ENUM('admin','staff'), active, sessions_invalidated_at
- Note: email is NOT unique at the database level

USER_SESSIONS
- PK: id
- FK: user_id → USERS.id  (ON DELETE CASCADE)
- UNIQUE: session_token (the JWT jti)

Relationship:
USERS 1 ────< USER_SESSIONS


LOGIN_HISTORY
- PK: id
- FK: user_id → USERS.id  (ON DELETE CASCADE)
- Notable: status ENUM('success','failed')

Relationship:
USERS 1 ────< LOGIN_HISTORY


NOTIFICATION_PREFS
- PK: id
- FK: user_id → USERS.id  (ON DELETE CASCADE)
- UNIQUE: user_id   ← this is what makes the relationship 1:1

Relationship:
USERS 1 ────1 NOTIFICATION_PREFS


AUDIT_LOGS
- PK: id
- FK: user_id → USERS.id  (ON DELETE SET NULL)
- Note: user_id is NULLABLE, required by SET NULL

Relationship:
USERS 1 ────< AUDIT_LOGS


DEVICES
- PK: id (varchar(255) UUID — a natural key, not an integer)
- Notable: secret_hash (bcrypt), active, locked_by, lock_time

READINGS
- PK: id
- FK: device_id → DEVICES.id  (ON DELETE CASCADE)

Relationship:
DEVICES 1 ────< READINGS


OTP_CODES
- PK: id
- Logical ref: user_id → USERS.id   (NO foreign key)

Relationship:
USERS 1 - - -< OTP_CODES


PASSWORD_RESETS
- PK: id
- Logical ref: email → USERS.email   (NO foreign key; non-unique both sides)

Relationship:
USERS 1 - - -< PASSWORD_RESETS      (weak — optional in the ERD)


INVENTORY
- PK: id
- No foreign keys at all
- Notable: count is SIGNED (+ in, − out)
- Notable: deleted (excludes from totals) vs is_archived (hides from list only)
- Note: NO owner column — nothing records who made the movement

COUNTING_SESSIONS
- PK: id
- Logical ref: user_id      → USERS.id      (NO FK — intentional)
- Logical ref: device_id    → DEVICES.id    (NO FK)
- Logical ref: inventory_id → INVENTORY.id  (NO FK; never populated)
- Notable: username is denormalised on purpose

Relationships:
USERS     1 - - -< COUNTING_SESSIONS
DEVICES   1 - - -< COUNTING_SESSIONS
INVENTORY 1 - - -1 COUNTING_SESSIONS   (optional both sides)


DEVICES.locked_by
- Logical ref: locked_by → USERS.id  (NO FK; char(36) vs bigint — type mismatch)

Relationship:
USERS 1 - - -< DEVICES   (via locked_by, at most one lock per device)


COUNTING_STATE
- PK: id (always 1; no AUTO_INCREMENT — this enforces the singleton)
- Standalone: no relationship to any other table

FEED_PURCHASES
- PK: id
- Standalone: no relationship to any other table
- Notable: purchased_on is DATE, not DATETIME
```

### Summary for drawing

| | Count |
| - | - |
| Entities (tables) | **13** |
| Solid lines (enforced FKs) | **5** |
| Dashed lines (logical refs) | **6** |
| 1:1 relationships | **2** (one enforced, one logical) |
| 1:M relationships | **9** |
| M:N relationships | **0** |
| Junction tables | **0** |
| Standalone entities | **2** (`counting_state`, `feed_purchases`) |

---

## 15. Final Level 1 DFD Structure

### Main flow — the system's primary path

```text
E3 FISH COUNTER DEVICE
    │  count + device_id + bearer token
    ↓
PROCESS 3.0: Ingest Fish Count
    │  verify token hash ↔ D4 Device Registry
    │  append reading    → D5 Sensor Readings
    │  (live count held in memory, broadcast via Socket.IO)
    ↓
E1 ADMIN / E2 STAFF   ← sees the count rise on the Counter screen
    │  presses Save (count, variant, notes)
    ↓
PROCESS 5.0: Manage Inventory
    │  insert signed movement → D7 Inventory Ledger
    │  mark session 'saved'   → D6 Counting Control
    ↓
PROCESS 7.0: Generate Reports & Dashboard
    │  aggregate reads ← D7 Inventory Ledger
    │  session reads   ← D6 Counting Control
    ↓
E1 ADMIN   ← stock levels, revenue, trends, exportable reports
```

> **Note the gap between 3.0 and 5.0.** The count passes through an **in-memory
> variable**, not through D5. There is no arrow from D5 into process 5.0.

### Authentication flow

```text
E1 ADMIN / E2 STAFF
    │  username + password
    ↓
PROCESS 1.0: Authenticate User
    │  read account        ← D1 User Accounts
    │  count recent fails  ← D3 Activity Log
    │  write attempt       → D3 Activity Log
    │  store hashed OTP    → D2 Auth Credentials
    │  send code           → E4 SMTP EMAIL SERVICE
    ↓
E1 / E2   ← OTP handle + masked email hint
    │  6-digit code
    ↓
PROCESS 1.0: Authenticate User
    │  consume OTP         ↔ D2 Auth Credentials
    │  record session      → D2 Auth Credentials
    │  set last_login      → D1 User Accounts
    │  write success       → D3 Activity Log
    ↓
E1 / E2   ← JWT token  (required by every process except 3.0)
```

### Counting-control flow

```text
E1 ADMIN / E2 STAFF
    │  Start (with variant)
    ↓
PROCESS 2.0: Control Counting Session
    │  lock + set active=1 ↔ D6 Counting Control
    │  open session row    → D6 Counting Control
    │  read device name    ← D4 Device Registry
    │  ══ launches OS subprocess ══> E3 FISH COUNTER DEVICE
    ↓
E1 / E2   ← started acknowledgement + broadcast to every connected screen
```

### Administrative flows

```text
E1 ADMIN
    │  feed purchase (date, amount, notes)
    ↓
PROCESS 6.0: Manage Feed Purchases
    │  insert          → D8 Feed Purchases
    │  audit entry     → D3 Activity Log
    │  read latest     ← D8 Feed Purchases   (countdown recomputed, never stored)
    ↓
E1 ADMIN   ← days remaining, status, cycles missed


E1 ADMIN
    │  new staff account (username, email, role)
    ↓
PROCESS 8.0: Administer Users & System
    │  insert user     → D1 User Accounts
    │  audit entry     → D3 Activity Log
    │  credentials     → E4 SMTP EMAIL SERVICE
    ↓
E1 ADMIN   ← account created


E1 ADMIN
    │  device registration
    ↓
PROCESS 4.0: Manage Devices & Locks
    │  write device + bcrypt token hash → D4 Device Registry
    ↓
E1 ADMIN   ← device id + plaintext token (shown once, unrecoverable)
```

### What flows along every arrow

| Arrow | Data on it |
| ----- | ---------- |
| E1/E2 → 1.0 | username, password; later the 6-digit OTP |
| 1.0 → D1 | user lookup by username or email; `last_login` write |
| 1.0 → D2 | SHA-256 OTP hash, expiry; session row keyed by JWT `jti` |
| 1.0 → D3 | attempt row: user_id, IP, User-Agent, success/failed |
| 1.0 → E4 | OTP email, reset link, new-account credentials |
| 1.0 → E1/E2 | signed JWT (8-hour expiry), user id, username, role |
| E3 → 3.0 | `{device_id, count, firmware, rssi}` + bearer token |
| 3.0 → D4 | bcrypt verify against `secret_hash`; `last_seen` stamp |
| 3.0 → D5 | device_id, count, server timestamp, full raw JSON payload |
| 3.0 → E3 | 201 with verified device id and accepted count |
| E1/E2 → 2.0 | start/stop command, variant |
| 2.0 → D6 | `active` flag (locked `FOR UPDATE`); session open/close with final count |
| 2.0 → E3 | OS-level process launch and terminate |
| E1/E2 → 5.0 | count, variant, notes — or an adjustment with type, items, price |
| 5.0 → D7 | signed movement row: count, variant, date, action, transaction_type |
| 5.0 → D6 | session status `saved` plus the inventory row id |
| D7 → 7.0 | filtered rows; ~15 aggregate sums for the dashboard |
| 7.0 → E1 | stock totals, revenue, trend series, report rows |
| E1 → 6.0 | purchased_on, amount, notes |
| 6.0 → D8 | purchase row; or soft-delete flag |
| D8 → 6.0 | latest purchase by `purchased_on`, for the countdown |
| E1/E2 → 8.0 | profile fields, passwords, staff details, notification toggles |
| 8.0 → D1 | user insert or update; preference upsert |
| 8.0 → D3 | audit row: action verb, object type and id, details, IP |

---

## What I Should Draw

### For the ERD

**13 entity boxes:**
`users`, `inventory`, `counting_sessions`, `counting_state`, `devices`, `readings`,
`feed_purchases`, `otp_codes`, `password_resets`, `user_sessions`, `login_history`,
`notification_prefs`, `audit_logs`

**5 solid lines (real foreign keys) — label each with its delete rule:**
```
users  1 ────<  user_sessions        (CASCADE)
users  1 ────<  login_history        (CASCADE)
users  1 ────1  notification_prefs   (CASCADE, UNIQUE)
users  1 ────<  audit_logs           (SET NULL)
devices 1 ────< readings             (CASCADE)
```

**6 dashed lines (logical, application-enforced):**
```
users     1 - - -<  otp_codes
users     1 - - -<  counting_sessions
devices   1 - - -<  counting_sessions
inventory 1 - - -1  counting_sessions   (optional)
users     1 - - -<  devices             (via locked_by)
users     1 - - -<  password_resets     (weak, by email — optional to include)
```

**2 entities with no relationships at all:** `counting_state`, `feed_purchases`.
Draw them as isolated boxes — do not invent a line to make the diagram look tidier.

**Do not draw:** any table from `planned_schema.sql`; any junction table; any line
between `inventory` and `users`.

**Add a legend** distinguishing solid (enforced) from dashed (logical). It is the single
thing that will make this ERD look considered rather than approximate.

### For the Level 1 DFD

**4 external entities (rectangles):**
E1 Admin · E2 Staff · E3 Fish Counter Device · E4 SMTP Email Service

**8 processes (circles, numbered):**
```
1.0 Authenticate User          5.0 Manage Inventory
2.0 Control Counting Session   6.0 Manage Feed Purchases
3.0 Ingest Fish Count          7.0 Generate Reports & Dashboard
4.0 Manage Devices & Locks     8.0 Administer Users & System
```

**8 data stores (open-ended rectangles):**
```
D1 User Accounts & Preferences   (users, notification_prefs)
D2 Authentication Credentials    (otp_codes, password_resets, user_sessions)
D3 Activity Log                  (login_history, audit_logs)
D4 Device Registry               (devices)
D5 Sensor Readings               (readings)
D6 Counting Control              (counting_state, counting_sessions)
D7 Inventory Ledger              (inventory)
D8 Feed Purchases                (feed_purchases)
```

**Four details that will set this diagram apart:**

1. **D5 gets an inbound arrow only.** Nothing reads `readings`. Resist the urge to
   balance the arrows.
2. **Draw the control arrow from 2.0 to E3.** The web app launches and kills the device
   process — a control flow to an external entity, not a data flow.
3. **Label the 1.0 → all-processes dependency.** A single annotated arrow, or a note, is
   enough: every process except 3.0 requires a valid JWT.
4. **E3's arrow into 3.0 carries a bearer token, not a username.** It is machine
   authentication, and labelling it as such shows the distinction is understood.

**Do not draw:** a Notification Management process; an arrow from D5 into 5.0; a single
merged "User" entity in place of Admin and Staff.

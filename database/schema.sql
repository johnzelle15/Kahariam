-- =====================================================================
--  Fish-Counter — AUTHORITATIVE SCHEMA (MariaDB)
--
--  Regenerated from the live `inventory` database on 2026-08-24.
--  This file is the single source of truth for a fresh install and
--  matches the running database exactly, table for table and index
--  for index.
--
--  Fresh install:
--      sudo mariadb < database/schema.sql
--
--  Do NOT run the files in database/migrations/ on a fresh install.
--  They are the historical record of how the live schema was reached
--  and are already folded into this file.
--
--  Tables not deployed and not used by any code live in
--  database/planned_schema.sql. That file is documentation only —
--  never run it against a working database.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS inventory
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE inventory;

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
--  Counting control
--  Singleton row (id = 1) shared by every client so the start/stop
--  toggle stays in sync across devices. backend/api/counting.py
--  reads and writes this row; the seed below is required.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS counting_state (
  id         int(11)    NOT NULL,
  active     tinyint(4) DEFAULT 0,
  updated_at datetime   DEFAULT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO counting_state (id, active, updated_at)
VALUES (1, 0, NOW())
ON DUPLICATE KEY UPDATE id = id;

-- ---------------------------------------------------------------------
--  Users / authentication
--  Role is a column on users; there is no separate roles table.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                      bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  username                varchar(150)        NOT NULL,
  password_hash           varchar(255)        NOT NULL,
  email                   varchar(255)        DEFAULT NULL,
  role                    enum('admin','staff') NOT NULL DEFAULT 'staff',
  active                  tinyint(1)          DEFAULT 1,
  created_at              timestamp           NULL DEFAULT current_timestamp(),
  fullname                varchar(200)        DEFAULT NULL,
  profile_image           text                DEFAULT NULL,
  last_login              datetime            DEFAULT NULL,
  failed_attempts         int(10) unsigned    NOT NULL DEFAULT 0,
  updated_at              datetime            DEFAULT NULL ON UPDATE current_timestamp(),
  sessions_invalidated_at datetime            DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Bootstrap admin (password: admin123 — CHANGE THIS IN PRODUCTION)
INSERT IGNORE INTO users (username, password_hash, email, role, active)
VALUES ('admin', '$2b$12$LJ3m4ys3Lk0TSwMCkGKYKePjVxGPLznGqir0OJsOaZKzJXqJqzYLu',
        'johnzelle.gabalones@gmail.com', 'admin', 1);

-- ---------------------------------------------------------------------
--  Devices — IoT registry. Also holds the kiosk lock (locked_by /
--  lock_time) used by backend/api/locks.py.
--  A device row is REQUIRED for /api/v1/ingest to authenticate;
--  seed one with scripts/utils/seed_device.py.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id          varchar(255) NOT NULL,
  name        varchar(120) DEFAULT NULL,
  location    varchar(120) DEFAULT NULL,
  model       varchar(100) DEFAULT NULL,
  firmware    varchar(64)  DEFAULT NULL,
  secret_hash varchar(255) NOT NULL,
  created_at  timestamp    NULL DEFAULT current_timestamp(),
  last_seen   timestamp    NULL DEFAULT NULL,
  active      tinyint(1)   DEFAULT 1,
  locked_by   char(36)     DEFAULT NULL,
  lock_time   timestamp    NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
--  Inventory — core business table. Every stock movement.
--
--  `deleted`     excludes a row from ALL stock calculations
--                (reserved for genuine data corrections).
--  `is_archived` hides a row from the active UI list only; archived
--                rows still count toward stock. These two flags are
--                deliberately separate — see migrations/add_is_archived.sql.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory (
  id               int(11)       NOT NULL AUTO_INCREMENT,
  count            int(11)       NOT NULL,
  variant          varchar(255)  NOT NULL,
  date             datetime      NOT NULL,
  notes            text          DEFAULT NULL,
  action           varchar(32)   DEFAULT 'IN',
  transaction_type varchar(20)   NOT NULL DEFAULT 'TANK_IN',
  price            decimal(10,2) DEFAULT NULL,
  total_price      decimal(10,2) DEFAULT NULL,
  deleted          tinyint(4)    DEFAULT 0,
  is_archived      tinyint(1)    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_is_archived (is_archived)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Readings — raw telemetry written by /api/v1/ingest.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS readings (
  id          bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  device_id   varchar(255)        NOT NULL,
  count       int(11)             NOT NULL,
  timestamp   timestamp           NOT NULL DEFAULT current_timestamp(),
  firmware    varchar(64)         DEFAULT NULL,
  raw_payload text                DEFAULT NULL,
  rssi        int(11)             DEFAULT NULL,
  created_at  timestamp           NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_device_time (device_id, timestamp),
  CONSTRAINT fk_readings_device FOREIGN KEY (device_id)
    REFERENCES devices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
--  Email OTP login codes (stored hashed, 5-minute validity).
--
--  NOTE: this table has no FOREIGN KEY on user_id, unlike every other
--  user-owned table below. That is how the live database was built
--  (backend/core/db.py creates it without one). Preserved as-is —
--  see database/migrations/cleanup_unused_indexes.sql for context.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_codes (
  id         bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id    bigint(20) unsigned NOT NULL,
  otp_code   varchar(255)        NOT NULL,
  expires_at datetime            NOT NULL,
  attempts   int(10) unsigned    NOT NULL DEFAULT 0,
  used       tinyint(1)          NOT NULL DEFAULT 0,
  created_at timestamp           NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_otp_user_expires (user_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  Password reset tokens (SHA-256 hex, 30-minute validity).
--  idx_pr_email_created also backs the 1-hour rate-limit COUNT(*).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id         bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  email      varchar(255)        NOT NULL,
  token_hash varchar(64)         NOT NULL,
  expires_at datetime            NOT NULL,
  used       tinyint(1)          NOT NULL DEFAULT 0,
  ip_address varchar(45)         DEFAULT NULL,
  created_at timestamp           NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_pr_email_created (email, created_at),
  KEY idx_pr_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
--  Active session tracking. session_token holds the JWT jti claim;
--  its UNIQUE index serves the per-token lookup.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  id            bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id       bigint(20) unsigned NOT NULL,
  session_token varchar(64)         NOT NULL COMMENT 'JWT jti claim (UUID v4)',
  ip_address    varchar(45)         DEFAULT NULL,
  device        text                DEFAULT NULL,
  created_at    datetime            NOT NULL DEFAULT current_timestamp(),
  last_seen     datetime            NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  is_active     tinyint(1)          NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY session_token (session_token),
  KEY idx_user_sessions_user (user_id),
  CONSTRAINT user_sessions_ibfk_1 FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
--  Login history (Settings → Security tab).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_history (
  id         bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id    bigint(20) unsigned NOT NULL,
  ip_address varchar(64)         NOT NULL DEFAULT '',
  device     varchar(255)        NOT NULL DEFAULT '',
  login_time datetime            NOT NULL DEFAULT current_timestamp(),
  status     enum('success','failed') NOT NULL DEFAULT 'success',
  PRIMARY KEY (id),
  KEY idx_lh_user_time (user_id, login_time),
  CONSTRAINT fk_lh_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
--  Per-user notification preferences (Settings → Notifications tab).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_prefs (
  id                  bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id             bigint(20) unsigned NOT NULL,
  email_notifications tinyint(1)          NOT NULL DEFAULT 1,
  inventory_alerts    tinyint(1)          NOT NULL DEFAULT 1,
  revenue_alerts      tinyint(1)          NOT NULL DEFAULT 1,
  anomaly_alerts      tinyint(1)          NOT NULL DEFAULT 1,
  task_reminders      tinyint(1)          NOT NULL DEFAULT 1,
  system_warnings     tinyint(1)          NOT NULL DEFAULT 1,
  updated_at          datetime            DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY user_id (user_id),
  CONSTRAINT fk_np_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
--  Audit log (Settings → Security tab, admin audit view).
--  object_id is written but not currently surfaced in the UI; it is
--  kept for forensic traceability.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id     bigint(20) unsigned DEFAULT NULL,
  action      varchar(100)        NOT NULL,
  object_type varchar(50)         DEFAULT NULL,
  object_id   varchar(50)         DEFAULT NULL,
  details     text                DEFAULT NULL,
  ip_address  varchar(45)         DEFAULT NULL,
  created_at  datetime            NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_audit_logs_user (user_id),
  KEY idx_audit_logs_created (created_at),
  CONSTRAINT audit_logs_ibfk_1 FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =====================================================================
--  End of schema — 11 tables, 5 foreign keys, no views, no triggers,
--  no stored procedures, no events.
--
--  Table collations are intentionally left as the live database has
--  them (counting_state / inventory / otp_codes are utf8mb4_unicode_ci,
--  the rest utf8mb4_general_ci). No cross-table string JOIN exists, so
--  this is harmless; normalising it would be a schema change, not a
--  cleanup.
-- =====================================================================

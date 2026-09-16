-- Counting sessions: a counting run as a real record.
--
-- Before this, a "session" was transient state (counting_state, one row, no
-- history) plus one inventory row on save. Nothing recorded who counted, on
-- which device, for how long, or whether the run was ever saved — so the
-- dashboard's "Recent Sessions" was really a list of inventory movements.
--
-- `username` is denormalised on purpose: session history should survive a
-- user being renamed or removed.

CREATE TABLE IF NOT EXISTS counting_sessions (
  id           int(11)             NOT NULL AUTO_INCREMENT,
  device_id    varchar(255)        DEFAULT NULL,
  user_id      bigint(20) unsigned DEFAULT NULL,
  username     varchar(120)        DEFAULT NULL,
  variant      varchar(255)        DEFAULT NULL,
  started_at   datetime            NOT NULL,
  ended_at     datetime            DEFAULT NULL,
  final_count  int(11)             NOT NULL DEFAULT 0,
  -- active: running. completed: stopped, not yet saved.
  -- saved: written to inventory. aborted: stopped with nothing counted.
  status       varchar(16)         NOT NULL DEFAULT 'active',
  inventory_id int(11)             DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_sessions_started (started_at),
  KEY idx_sessions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

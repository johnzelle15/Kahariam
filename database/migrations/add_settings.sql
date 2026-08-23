-- Migration: Settings Module
-- Extends users table and adds login_history, notification_prefs tables.
-- Run after schema.sql and add_otp_auth.sql

-- ── Extend users table ────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS fullname      VARCHAR(200) NULL,
  ADD COLUMN IF NOT EXISTS profile_image TEXT         NULL,
  ADD COLUMN IF NOT EXISTS last_login    DATETIME     NULL,
  ADD COLUMN IF NOT EXISTS failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at    DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP;

-- ── Login history ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_history (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  ip_address VARCHAR(64)  NOT NULL DEFAULT '',
  device     VARCHAR(255) NOT NULL DEFAULT '',
  login_time DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status     ENUM('success', 'failed') NOT NULL DEFAULT 'success',
  INDEX idx_lh_user_time (user_id, login_time),
  CONSTRAINT fk_lh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ── Notification preferences ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_prefs (
  id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id              BIGINT UNSIGNED NOT NULL UNIQUE,
  email_notifications  TINYINT(1) NOT NULL DEFAULT 1,
  inventory_alerts     TINYINT(1) NOT NULL DEFAULT 1,
  revenue_alerts       TINYINT(1) NOT NULL DEFAULT 1,
  anomaly_alerts       TINYINT(1) NOT NULL DEFAULT 1,
  task_reminders       TINYINT(1) NOT NULL DEFAULT 1,
  system_warnings      TINYINT(1) NOT NULL DEFAULT 1,
  updated_at           DATETIME   NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_np_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

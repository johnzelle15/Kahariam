-- ============================================================
-- RBAC Enhancement Migration
-- Adds: audit_logs, user_sessions tables
--       sessions_invalidated_at column on users
-- ============================================================

-- ── Session invalidation support (logout-all-devices) ────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sessions_invalidated_at DATETIME NULL DEFAULT NULL;

-- ── Active session tracking ──────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
  id              INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED    NOT NULL,
  session_token   VARCHAR(64)     UNIQUE NOT NULL COMMENT 'JWT jti claim (UUID v4)',
  ip_address      VARCHAR(45),
  device          TEXT,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active       TINYINT(1)      NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_sessions_user   (user_id),
  INDEX idx_user_sessions_token  (session_token),
  INDEX idx_user_sessions_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Audit log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id           INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED,
  action       VARCHAR(100)  NOT NULL,
  object_type  VARCHAR(50),
  object_id    VARCHAR(50),
  details      TEXT,
  ip_address   VARCHAR(45),
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_logs_user    (user_id),
  INDEX idx_audit_logs_action  (action),
  INDEX idx_audit_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

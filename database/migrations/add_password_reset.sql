-- Migration: Add Password Reset Feature
-- Creates password_resets table for secure forgot-password flow.

CREATE TABLE IF NOT EXISTS password_resets (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(255)    NOT NULL,
  token_hash VARCHAR(64)     NOT NULL,        -- SHA-256 hex of the raw token
  expires_at DATETIME        NOT NULL,
  used       TINYINT(1)      NOT NULL DEFAULT 0,
  ip_address VARCHAR(45)     NULL,            -- for audit logging
  created_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pr_email_created (email, created_at),
  INDEX idx_pr_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

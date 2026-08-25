-- Migration: Add Email OTP Authentication
-- Adds role column to users table and creates otp_codes table.

-- Add role column to users table (admin or staff)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role ENUM('admin', 'staff') NOT NULL DEFAULT 'staff';

-- OTP codes table
CREATE TABLE IF NOT EXISTS otp_codes (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id   BIGINT UNSIGNED NOT NULL,
  otp_code  VARCHAR(255)    NOT NULL,  -- stored hashed
  expires_at DATETIME       NOT NULL,
  attempts  INT UNSIGNED    NOT NULL DEFAULT 0,
  used      TINYINT(1)      NOT NULL DEFAULT 0,
  created_at TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_otp_user_expires (user_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Admin user seeding moved to scripts/utils/seed_admin.py — no fixed
-- password is committed to source.

-- =====================================================================
--  Migration: database cleanup — unused/duplicate indexes + spent tokens
--  Date:      2026-08-24
--  Target:    MariaDB schema `inventory`
--
--  Scope: removes only confirmed-unused database objects. No table is
--  dropped, no column is dropped, no business data is touched, no
--  relationship or constraint is changed. API compatibility unaffected.
--
--  *** DESTRUCTIVE — TAKE THE BACKUP IN SECTION 0 BEFORE RUNNING ***
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. BACKUP FIRST  (shell, not SQL)
-- ---------------------------------------------------------------------
--   mkdir -p ~/Fish-Counter/runtime/backups
--   sudo mysqldump --single-transaction --routines --triggers --events \
--        inventory | gzip > ~/Fish-Counter/runtime/backups/inventory_pre_cleanup_$(date +%F_%H%M%S).sql.gz
--
--   # prove the backup restores before you touch the live schema:
--   sudo mariadb -e "CREATE DATABASE inventory_restoretest"
--   zcat ~/Fish-Counter/runtime/backups/inventory_pre_cleanup_*.sql.gz | sudo mariadb inventory_restoretest
--   sudo mariadb -e "DROP DATABASE inventory_restoretest"

USE inventory;

-- ---------------------------------------------------------------------
-- 1. DUPLICATE INDEX                        [DESTRUCTIVE: DROP INDEX]
--
--    `session_token` (UNIQUE) and `idx_user_sessions_token` (non-unique)
--    index the identical single column. The UNIQUE index backs the
--    constraint and must stay; the non-unique copy is pure write cost.
--    Lookups at auth_otp.py:234 keep using the UNIQUE index.
-- ---------------------------------------------------------------------
ALTER TABLE user_sessions DROP INDEX idx_user_sessions_token;

-- ---------------------------------------------------------------------
-- 2. UNUSED INDEXES                         [DESTRUCTIVE: DROP INDEX]
--
--    inventory.transaction_type — appears only in INSERT and SELECT
--      column lists across inventory.py; never a WHERE/JOIN/GROUP BY
--      predicate, so this index can never be chosen.
--    audit_logs.action — same; both audit queries (settings.py:357, :805)
--      filter on user_id or nothing and order by created_at.
--    user_sessions.is_active — only ever read alongside user_id
--      (settings.py:851) or session_token (auth_otp.py:234); the
--      user_id / UNIQUE-token indexes win in both cases. A 2-value
--      tinyint index is never selective enough to be picked.
-- ---------------------------------------------------------------------
ALTER TABLE inventory      DROP INDEX idx_transaction_type;
ALTER TABLE audit_logs     DROP INDEX idx_audit_logs_action;
ALTER TABLE user_sessions  DROP INDEX idx_user_sessions_active;

-- ---------------------------------------------------------------------
-- 3. SPENT AUTH ARTIFACTS                   [DESTRUCTIVE: DELETE]
--
--    Single-use tokens, already consumed or expired. No FK dependents,
--    no reporting reads them. Nothing in the application ever deletes
--    from these tables, so they grow without bound.
--
--    The 7-day cut-off sits far outside every window the code enforces:
--    OTP validity 5 min, reset-token validity 30 min, and the
--    forgot-password rate-limit lookback of 1 hour (auth_otp.py:695) —
--    so rate limiting is unaffected.
-- ---------------------------------------------------------------------
DELETE FROM otp_codes
 WHERE (used = 1 OR expires_at < NOW())
   AND created_at < NOW() - INTERVAL 7 DAY;

DELETE FROM password_resets
 WHERE (used = 1 OR expires_at < NOW())
   AND created_at < NOW() - INTERVAL 7 DAY;

-- ---------------------------------------------------------------------
-- 4. VERIFY (non-destructive)
-- ---------------------------------------------------------------------
SHOW INDEX FROM user_sessions;   -- expect: PRIMARY, session_token, idx_user_sessions_user
SHOW INDEX FROM inventory;       -- expect: PRIMARY, idx_is_archived
SHOW INDEX FROM audit_logs;      -- expect: PRIMARY, idx_audit_logs_user, idx_audit_logs_created

SELECT 'otp_codes' AS t, COUNT(*) AS remaining FROM otp_codes
UNION ALL SELECT 'password_resets', COUNT(*) FROM password_resets;

-- =====================================================================
--  ROLLBACK (indexes only; deleted token rows come back from the backup)
-- =====================================================================
--   ALTER TABLE user_sessions ADD INDEX idx_user_sessions_token  (session_token);
--   ALTER TABLE user_sessions ADD INDEX idx_user_sessions_active (is_active);
--   ALTER TABLE inventory     ADD INDEX idx_transaction_type     (transaction_type);
--   ALTER TABLE audit_logs    ADD INDEX idx_audit_logs_action    (action);

-- =====================================================================
--  DELIBERATELY EXCLUDED
--
--  audit_logs.object_id      write-only, but it is the forensic link in
--                            REVOKE_SESSION / CREATE_STAFF entries.
--                            Dropping it needs a settings.py edit. Keep.
--  users.failed_attempts     read-only (returned by /settings/profile,
--                            never incremented, never displayed). One
--                            tinyint; dropping it needs a settings.py
--                            edit for zero space gain. Keep.
--  user_sessions (is_active=0)  revoked rows are soft-referenced by
--                            audit_logs.object_id. Deleting them breaks
--                            the audit trail. Keep.
--  otp_codes FK              otp_codes.user_id has no FOREIGN KEY, unlike
--                            every sibling table (init_db() creates the
--                            table without the one add_otp_auth.sql
--                            declares). No orphans exist today. ADDING it
--                            would change user-deletion behaviour, so it
--                            is out of scope for a cleanup. Tracked, not
--                            applied.
--
--  NOT FIXABLE IN SQL: database/schema.sql and database/sqlviewer.txt are
--  stale. They declare 8 tables that exist nowhere (roles, user_roles,
--  suppliers, purchase_orders, purchase_items, ota_tasks, calibrations,
--  notifications) and omit 6 the app requires. Regenerate them from the
--  live schema; do not run them.
-- =====================================================================

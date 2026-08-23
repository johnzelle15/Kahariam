-- Migration: separate archive flag from stock-exclusion flag
--
-- Root cause: `deleted = 1` was used both to hide records from the UI and to
-- exclude them from every stock-calculation query.  Archiving a SOLD record
-- therefore silently reversed the sale (stock went up).
--
-- Fix: add `is_archived` for UI visibility only.
--   • Archive button  → SET is_archived = 1  (deleted stays 0 → still counted in stock)
--   • Stock queries   → WHERE deleted = 0     (unchanged; is_archived is irrelevant)
--   • Active UI list  → WHERE deleted = 0 AND is_archived = 0
--   • Archive view    → WHERE is_archived = 1
--   • `deleted`       → reserved for genuine data corrections / hard-delete (not used by archive button)

ALTER TABLE inventory
  ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0
  AFTER deleted;

CREATE INDEX idx_is_archived ON inventory (is_archived);

-- Back-fill: existing records that were already archived via the old `deleted` flag
-- are surfaced in the archive view.  Their `deleted` flag stays 1 so their
-- contribution to historic stock totals is preserved unchanged.
UPDATE inventory SET is_archived = 1 WHERE deleted = 1;

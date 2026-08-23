-- Migration: Add transaction_type and price columns to inventory
-- Date: 2026-04-20
-- Purpose: Structured transaction system (SOLD, DIED, TANK_IN, WHOLESALE_IN)

-- Step 1: Add new columns
ALTER TABLE inventory
  ADD COLUMN transaction_type VARCHAR(20) NULL AFTER action,
  ADD COLUMN price DECIMAL(10,2) NULL AFTER transaction_type,
  ADD COLUMN total_price DECIMAL(10,2) NULL AFTER price;

-- Step 2: Backfill transaction_type from existing action + notes
UPDATE inventory
SET transaction_type = CASE
  WHEN action = 'OUT' AND LOWER(notes) LIKE 'died%' THEN 'DIED'
  WHEN action = 'OUT' THEN 'SOLD'
  WHEN action = 'IN' THEN 'TANK_IN'
  WHEN action IN ('WHOLESALE', 'INVENTORY') AND count > 0 THEN 'WHOLESALE_IN'
  WHEN action IN ('WHOLESALE', 'INVENTORY') AND count < 0 AND LOWER(notes) LIKE 'died%' THEN 'DIED'
  WHEN action IN ('WHOLESALE', 'INVENTORY') AND count < 0 THEN 'SOLD'
  ELSE 'TANK_IN'
END
WHERE transaction_type IS NULL;

-- Step 3: Add index on new column
CREATE INDEX idx_transaction_type ON inventory (transaction_type);

-- Step 4: Make transaction_type NOT NULL after backfill
ALTER TABLE inventory MODIFY COLUMN transaction_type VARCHAR(20) NOT NULL DEFAULT 'TANK_IN';

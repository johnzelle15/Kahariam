-- MariaDB migration: ensure `inventory.action` supports INVENTORY and WHOLESALE
-- Safe for existing data (does not drop table/data)

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE inventory
  MODIFY COLUMN action ENUM('IN','OUT','INVENTORY','WHOLESALE') NOT NULL DEFAULT 'IN';

-- Fish-Counter runtime schema (MariaDB)
-- Purpose: exact tables needed by current Flask app runtime for Raspberry Pi deployment.

SET NAMES utf8mb4 COLLATE utf8mb4_general_ci;

CREATE DATABASE IF NOT EXISTS inventory
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE inventory;

CREATE TABLE IF NOT EXISTS counting_state (
  id INT PRIMARY KEY,
  active TINYINT DEFAULT 0,
  updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO counting_state (id, active, updated_at)
VALUES (1, 0, NOW())
ON DUPLICATE KEY UPDATE id = id;

CREATE TABLE IF NOT EXISTS inventory (
  id INT PRIMARY KEY AUTO_INCREMENT,
  count INT NOT NULL,
  variant VARCHAR(255) NOT NULL,
  date DATETIME NOT NULL,
  notes TEXT,
  action VARCHAR(32) DEFAULT 'IN',
  deleted TINYINT DEFAULT 0,
  INDEX idx_inventory_variant_date (variant, date),
  INDEX idx_inventory_deleted_action (deleted, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255),
  location VARCHAR(255),
  model VARCHAR(255),
  firmware VARCHAR(255),
  secret_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME,
  active TINYINT DEFAULT 1,
  locked_by VARCHAR(255),
  lock_time DATETIME,
  INDEX idx_devices_last_seen (last_seen),
  INDEX idx_devices_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS readings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  device_id VARCHAR(255),
  count INT,
  timestamp DATETIME,
  firmware VARCHAR(255),
  raw_payload TEXT,
  rssi INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_readings_device_time (device_id, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

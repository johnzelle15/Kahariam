-- Feed purchases: the record the feed purchasing alert is worked out from.
--
-- The farm buys feed about every 14 days. backend/api/feed.py finds the latest
-- purchase by date and counts down to the next one; nothing about the alert is
-- stored, so recording, correcting or deleting a purchase moves it on its own.
--
-- `purchased_on` is a DATE, not a DATETIME: the schedule is in whole days, and
-- a time of day would only let the countdown drift across midnight.
-- `deleted` is a soft delete, the same convention as inventory. Who recorded
-- or changed a purchase goes to audit_logs.
--
-- backend/core/db.py init_db() also creates this table on startup, so a
-- running install picks it up on restart without this file.

CREATE TABLE IF NOT EXISTS feed_purchases (
  id           int(11)       NOT NULL AUTO_INCREMENT,
  purchased_on date          NOT NULL,
  amount       decimal(10,2) NOT NULL,
  notes        varchar(255)  DEFAULT NULL,
  deleted      tinyint(1)    NOT NULL DEFAULT 0,
  created_at   timestamp     NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

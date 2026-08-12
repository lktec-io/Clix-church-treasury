ALTER TABLE users
  ADD COLUMN failed_login_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN locked_until DATETIME NULL AFTER failed_login_attempts;

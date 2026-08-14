DROP TABLE IF EXISTS contributor_sequences;

ALTER TABLE contributors
  DROP COLUMN portal_enabled_at,
  DROP COLUMN locale,
  DROP COLUMN pin_locked_until,
  DROP COLUMN failed_pin_attempts,
  DROP COLUMN must_change_pin,
  DROP COLUMN pin_hash;

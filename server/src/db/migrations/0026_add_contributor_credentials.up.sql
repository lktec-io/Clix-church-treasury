-- Adds member self-service credentials to the existing contributor
-- directory row (rather than a separate table) — a contributor either has
-- portal access enabled or doesn't; `portal_enabled_at` is the marker.
-- All columns nullable/defaulted so every existing contributor row is
-- unaffected until a treasurer explicitly enables portal access
-- (server/src/modules/memberAuth/enrollment.service.js).
ALTER TABLE contributors
  ADD COLUMN pin_hash VARCHAR(255) NULL AFTER member_number,
  ADD COLUMN must_change_pin BOOLEAN NOT NULL DEFAULT TRUE AFTER pin_hash,
  ADD COLUMN failed_pin_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER must_change_pin,
  ADD COLUMN pin_locked_until DATETIME NULL AFTER failed_pin_attempts,
  ADD COLUMN locale VARCHAR(5) NULL AFTER pin_locked_until,
  ADD COLUMN portal_enabled_at DATETIME NULL AFTER locale;

-- Backs server-side, collision-proof, per-tenant member-number generation
-- ("M0001", "M0002", ...) — same row-locked-counter pattern as
-- receipt_sequences (0023_create_receipt_sequences.up.sql), read with
-- SELECT ... FOR UPDATE inside the same transaction as the contributor
-- update (server/src/modules/memberAuth/memberNumber.js). Never resets —
-- member numbers are permanent, unlike receipt numbers which reset yearly.
CREATE TABLE contributor_sequences (
  tenant_id BIGINT UNSIGNED NOT NULL,
  next_number INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_contributor_sequences_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

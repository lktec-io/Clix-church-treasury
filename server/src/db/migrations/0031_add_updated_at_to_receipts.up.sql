-- Production root-cause fix: receipts.repository.js extends
-- TenantScopedRepository, whose insert()/update() unconditionally set
-- `updated_at` on every table they touch (server/src/db/
-- TenantScopedRepository.js) — a contract every other table in this
-- schema already satisfies. `receipts` (0024_create_receipts.up.sql) was
-- created with `created_at` only, predating that contract being applied
-- uniformly, so every POST /contributions call (which always issues a
-- receipt in the same transaction) failed with
-- ER_BAD_FIELD_ERROR: Unknown column 'updated_at' in 'field list'.
--
-- DEFAULT CURRENT_TIMESTAMP backfills existing rows in the same
-- statement (receipts are never updated by application code after
-- issuance — see receipts.repository.js, no update() override, no
-- PATCH/PUT route — so the exact backfilled value has no behavioral
-- meaning, it only needs to be non-null to satisfy the column contract).
ALTER TABLE receipts
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER created_at;

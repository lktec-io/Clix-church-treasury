-- Backs server-side, collision-proof, per-tenant-per-year receipt numbering.
-- `next_number` is read with SELECT ... FOR UPDATE inside the same
-- transaction as the receipt insert, so concurrent requests serialize on
-- this row rather than racing (server/src/modules/receipts/receiptNumber.js).
CREATE TABLE receipt_sequences (
  tenant_id BIGINT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  next_number INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, year),
  CONSTRAINT fk_receipt_sequences_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

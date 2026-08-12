-- The append-only financial ledger. Table structure only — Phase 3 builds the
-- posting/balance/reversal/adjustment services on top of this. No row here is
-- ever UPDATEd or DELETEd by application code once status = 'posted'.
--
-- `direction` disambiguates effect from `type`: a transfer posts two rows that
-- share type='transfer' but oppose in direction (one 'out' of the source, one
-- 'in' to the destination). income='in', expense='out', reversal is the
-- opposite direction of the row it reverses, adjustment can be either.
CREATE TABLE transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  transaction_number VARCHAR(50) NOT NULL,
  type ENUM('income', 'expense', 'transfer', 'reversal', 'adjustment') NOT NULL,
  direction ENUM('in', 'out') NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  fund_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  financial_period_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  payment_method VARCHAR(50) NULL,
  reference_type VARCHAR(50) NULL,
  reference_id BIGINT UNSIGNED NULL,
  description VARCHAR(500) NULL,
  status ENUM('draft', 'pending_approval', 'posted', 'rejected', 'reversed') NOT NULL DEFAULT 'draft',
  reversed_by_transaction_id BIGINT UNSIGNED NULL,
  posted_at DATETIME NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_transactions_tenant_number (tenant_id, transaction_number),
  KEY idx_transactions_tenant_status (tenant_id, status),
  KEY idx_transactions_tenant_period (tenant_id, financial_period_id),
  KEY idx_transactions_tenant_account (tenant_id, account_id),
  KEY idx_transactions_tenant_fund (tenant_id, fund_id),
  KEY idx_transactions_tenant_created (tenant_id, created_at),
  KEY idx_transactions_reference (reference_type, reference_id),
  CONSTRAINT fk_transactions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_fund FOREIGN KEY (fund_id) REFERENCES funds (id) ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_period FOREIGN KEY (financial_period_id) REFERENCES financial_periods (id) ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_reversed_by FOREIGN KEY (reversed_by_transaction_id) REFERENCES transactions (id) ON DELETE RESTRICT,
  CONSTRAINT chk_transactions_amount_positive CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The domain record behind an income ledger posting. `amount`/`status` are
-- denormalized from the linked `transactions` row for cheap listing without a
-- join — they are never edited independently of it; a reversal updates both
-- in the same DB transaction (contributions.service.js#reverseContribution).
CREATE TABLE contributions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  contributor_id BIGINT UNSIGNED NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  fund_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  transaction_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  contribution_date DATE NOT NULL,
  reference VARCHAR(100) NULL,
  notes VARCHAR(500) NULL,
  status ENUM('posted', 'reversed') NOT NULL DEFAULT 'posted',
  recorded_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_contributions_transaction (transaction_id),
  KEY idx_contributions_tenant_date (tenant_id, contribution_date),
  KEY idx_contributions_tenant_contributor (tenant_id, contributor_id),
  KEY idx_contributions_tenant_status (tenant_id, status),
  CONSTRAINT fk_contributions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_contributions_contributor FOREIGN KEY (contributor_id) REFERENCES contributors (id) ON DELETE RESTRICT,
  CONSTRAINT fk_contributions_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_contributions_fund FOREIGN KEY (fund_id) REFERENCES funds (id) ON DELETE RESTRICT,
  CONSTRAINT fk_contributions_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT,
  CONSTRAINT fk_contributions_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_contributions_recorded_by FOREIGN KEY (recorded_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_contributions_amount_positive CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

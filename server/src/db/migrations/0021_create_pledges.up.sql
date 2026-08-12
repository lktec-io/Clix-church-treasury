-- A pledge is a commitment, not money received — it never posts a ledger
-- transaction on its own (docs/FINANCIAL_ARCHITECTURE.md §7). Fulfillment is
-- always derived from linked `contributions` rows, never stored here.
CREATE TABLE pledges (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  pledge_number VARCHAR(50) NOT NULL,
  contributor_id BIGINT UNSIGNED NOT NULL,
  fund_id BIGINT UNSIGNED NOT NULL,
  pledged_amount DECIMAL(14, 2) NOT NULL,
  pledge_date DATE NOT NULL,
  target_date DATE NULL,
  notes VARCHAR(500) NULL,
  status ENUM('active', 'completed', 'cancelled') NOT NULL DEFAULT 'active',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_pledges_tenant_number (tenant_id, pledge_number),
  KEY idx_pledges_tenant_contributor (tenant_id, contributor_id),
  KEY idx_pledges_tenant_status (tenant_id, status),
  CONSTRAINT fk_pledges_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pledges_contributor FOREIGN KEY (contributor_id) REFERENCES contributors (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pledges_fund FOREIGN KEY (fund_id) REFERENCES funds (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pledges_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_pledges_amount_positive CHECK (pledged_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

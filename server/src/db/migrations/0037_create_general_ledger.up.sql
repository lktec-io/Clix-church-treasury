CREATE TABLE remittance_rules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  fund_id BIGINT UNSIGNED NOT NULL,
  higher_body_name VARCHAR(150) NOT NULL,
  percentage_to_remit DECIMAL(5, 2) NOT NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_remittance_rules_tenant_fund (tenant_id, fund_id),
  KEY idx_remittance_rules_tenant_status (tenant_id, status),
  CONSTRAINT fk_remittance_rules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_remittance_rules_fund FOREIGN KEY (fund_id) REFERENCES funds (id) ON DELETE RESTRICT,
  CONSTRAINT chk_remittance_rules_percentage CHECK (percentage_to_remit >= 0 AND percentage_to_remit <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE remittance_ledgers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  financial_period_id BIGINT UNSIGNED NOT NULL,
  rule_id BIGINT UNSIGNED NOT NULL,
  fund_id BIGINT UNSIGNED NOT NULL,
  amount_accrued DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  amount_paid DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  status_flag ENUM('pending_transfer', 'partially_remitted', 'fully_remitted') NOT NULL DEFAULT 'pending_transfer',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_remittance_ledgers_period_rule (tenant_id, financial_period_id, rule_id),
  KEY idx_remittance_ledgers_tenant_status (tenant_id, status_flag),
  CONSTRAINT fk_remittance_ledgers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_remittance_ledgers_period FOREIGN KEY (financial_period_id) REFERENCES financial_periods (id) ON DELETE RESTRICT,
  CONSTRAINT fk_remittance_ledgers_rule FOREIGN KEY (rule_id) REFERENCES remittance_rules (id) ON DELETE RESTRICT,
  CONSTRAINT fk_remittance_ledgers_fund FOREIGN KEY (fund_id) REFERENCES funds (id) ON DELETE RESTRICT,
  CONSTRAINT chk_remittance_ledgers_amounts CHECK (amount_accrued >= 0 AND amount_paid >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

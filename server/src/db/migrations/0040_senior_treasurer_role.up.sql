INSERT INTO roles (tenant_id, name, description, is_system, created_at, updated_at)
SELECT NULL,
       'Senior Treasurer',
       'Mhazini Mkuu — everything a Treasurer can do, plus authority to approve and reject expenses.',
       TRUE,
       UTC_TIMESTAMP(),
       UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE tenant_id IS NULL AND name = 'Senior Treasurer'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.name IN (
      'dashboard.view',
      'income.view', 'income.create', 'income.update', 'income.reverse',
      'contributors.view', 'contributors.manage',
      'expense.view', 'expense.create', 'expense.update', 'expense.submit',
      'expense.approve', 'expense.reject', 'expense.pay',
      'accounts.view', 'accounts.manage',
      'funds.view', 'funds.manage',
      'categories.manage',
      'transfers.create',
      'pledges.view', 'pledges.create',
      'receipts.view',
      'reports.view', 'reports.export',
      'budget.view', 'budget.manage',
      'financial_period.view', 'financial_period.manage', 'financial_period.close',
      'remittance.view', 'remittance.pay'
    )
 WHERE r.tenant_id IS NULL
   AND r.name = 'Senior Treasurer'
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );

CREATE TABLE IF NOT EXISTS journal_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  financial_period_id BIGINT UNSIGNED NOT NULL,
  reference_type VARCHAR(100) NULL,
  reference_id BIGINT UNSIGNED NULL,
  narration VARCHAR(255) NOT NULL,
  posted_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_je_tenant_period (tenant_id, financial_period_id),
  CONSTRAINT fk_je_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_je_period FOREIGN KEY (financial_period_id) REFERENCES financial_periods (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS journal_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  entry_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  entry_type ENUM('debit', 'credit') NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_jl_tenant_entry (tenant_id, entry_id),
  KEY idx_jl_tenant_account (tenant_id, account_id),
  CONSTRAINT fk_jl_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_jl_entry FOREIGN KEY (entry_id) REFERENCES journal_entries (id) ON DELETE RESTRICT,
  CONSTRAINT fk_jl_account FOREIGN KEY (account_id) REFERENCES chart_of_accounts (id) ON DELETE RESTRICT,
  CONSTRAINT chk_jl_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

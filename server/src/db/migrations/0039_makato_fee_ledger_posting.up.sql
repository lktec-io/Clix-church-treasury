CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  name_sw VARCHAR(150) NULL,
  account_type ENUM('asset', 'liability', 'equity', 'revenue', 'expense') NOT NULL,
  normal_balance ENUM('debit', 'credit') NOT NULL,
  system_role VARCHAR(100) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_coa_tenant_code (tenant_id, code),
  CONSTRAINT fk_coa_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO chart_of_accounts
  (tenant_id, code, name, name_sw, account_type, normal_balance, system_role, is_active, created_at, updated_at)
SELECT t.id, '5300', 'Mobile Money Fees (Makato)', 'Makato ya Pesa kwa Simu', 'expense', 'debit',
       'mobile_money_fees', TRUE, UTC_TIMESTAMP(), UTC_TIMESTAMP()
  FROM tenants t;

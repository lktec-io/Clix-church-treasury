CREATE TABLE financial_periods (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  closed_by_user_id BIGINT UNSIGNED NULL,
  closed_at DATETIME NULL,
  reopened_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_financial_periods_tenant_label (tenant_id, label),
  KEY idx_financial_periods_tenant_status (tenant_id, status),
  CONSTRAINT fk_financial_periods_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_financial_periods_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_financial_periods_dates CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

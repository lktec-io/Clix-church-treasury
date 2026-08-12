CREATE TABLE church_settings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  logo_url VARCHAR(500) NULL,
  address VARCHAR(500) NULL,
  phone VARCHAR(50) NULL,
  email VARCHAR(255) NULL,
  fiscal_year_start_month TINYINT UNSIGNED NOT NULL DEFAULT 1,
  receipt_number_format VARCHAR(100) NOT NULL DEFAULT 'RCT-{YYYY}-{SEQ}',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_church_settings_tenant (tenant_id),
  CONSTRAINT fk_church_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT chk_church_settings_fy_month CHECK (fiscal_year_start_month BETWEEN 1 AND 12)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

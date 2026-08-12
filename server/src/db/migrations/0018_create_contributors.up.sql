-- Contributor directory (donor PII). Deliberately a separate table from
-- `contributions` so contributor-detail visibility can be permissioned
-- independently of income-amount visibility (docs/SECURITY_ARCHITECTURE.md).
CREATE TABLE contributors (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NULL,
  email VARCHAR(255) NULL,
  member_number VARCHAR(50) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_contributors_tenant (tenant_id),
  UNIQUE KEY uq_contributors_tenant_member_number (tenant_id, member_number),
  CONSTRAINT fk_contributors_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

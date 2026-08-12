-- tenant_id NULL = system-default role available to every tenant (Treasurer, Admin, ...).
-- tenant_id set = a tenant's own custom role.
-- Note: MySQL unique indexes treat NULL as distinct from every other NULL, so
-- UNIQUE(tenant_id, name) only protects per-tenant custom role names from colliding
-- with each other — it does NOT stop two system-default rows (tenant_id NULL) from
-- sharing a name. Uniqueness among system-default roles is guaranteed by the seed
-- script being idempotent (checks existence before inserting), not by this constraint.
CREATE TABLE roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_roles_tenant_name (tenant_id, name),
  KEY idx_roles_tenant (tenant_id),
  CONSTRAINT fk_roles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

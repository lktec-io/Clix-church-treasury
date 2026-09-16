-- Four additive features, one migration. Every new column is NULLable or
-- defaulted, so no existing row changes meaning and every current write path
-- keeps working unchanged.

-- 1. CHURCH DEPARTMENTS (Kwaya, Vijana, Huduma za Jamii, Idara ya Watoto …)
-- Tenant-owned rows, not a hardcoded list: denominations and congregations
-- organise ministries differently, so the four common ones are seeded as a
-- starting point that each church can rename or extend.
CREATE TABLE departments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_departments_tenant_name (tenant_id, name),
  KEY idx_departments_tenant (tenant_id),
  CONSTRAINT fk_departments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the defaults for every church that already exists. New churches get
-- the same set from tenants.service.js at creation time.
INSERT INTO departments (tenant_id, name, is_active, created_at, updated_at)
SELECT t.id, d.name, TRUE, UTC_TIMESTAMP(), UTC_TIMESTAMP()
  FROM tenants t
 CROSS JOIN (
   SELECT 'Kwaya' AS name
   UNION ALL SELECT 'Vijana'
   UNION ALL SELECT 'Huduma za Jamii'
   UNION ALL SELECT 'Idara ya Watoto'
 ) d;

-- 2. CONTRIBUTION: department + mobile-money transfer fee (makato)
--
-- ACCOUNTING DECISION, stated here because it is the one that matters:
-- `contributions.amount` stays the FULL amount the member sent. That is the
-- member's gift, and it is what their tithe statement must show — a member
-- must not be recorded as having given 9,500 because the agent took 500.
-- The fee is recorded separately in `transfer_fee` as a cost the church
-- bore. It is tracked and aggregated (the Makato dashboard card); it is NOT
-- posted to the ledger as a separate expense by this migration.
ALTER TABLE contributions
  ADD COLUMN department_id BIGINT UNSIGNED NULL AFTER category_id,
  ADD COLUMN mobile_provider ENUM('mpesa', 'tigo_pesa', 'airtel_money', 'halopesa', 'other') NULL AFTER payment_method,
  ADD COLUMN transfer_fee DECIMAL(14, 2) NULL AFTER mobile_provider,
  ADD CONSTRAINT fk_contributions_department FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE RESTRICT,
  ADD CONSTRAINT chk_contributions_transfer_fee CHECK (transfer_fee IS NULL OR transfer_fee >= 0),
  ADD KEY idx_contributions_tenant_department (tenant_id, department_id);

-- 3. MEMBER IDENTITY DOCUMENT
-- `id_number` is national-ID PII. It lives on the contributor row, which is
-- already gated by contributors.view — the permission that exists precisely
-- to separate donor identity from financial visibility.
-- `id_note` carries the free-text explanation when a member has no document.
ALTER TABLE contributors
  ADD COLUMN id_type ENUM('nida', 'voter_id', 'driving_licence', 'none') NULL AFTER email,
  ADD COLUMN id_number VARCHAR(30) NULL AFTER id_type,
  ADD COLUMN id_note VARCHAR(255) NULL AFTER id_number;

-- 4. PLEDGE FREQUENCY
-- 'once' is the default so every existing pledge keeps its current meaning:
-- a single commitment with no installment schedule.
ALTER TABLE pledges
  ADD COLUMN frequency ENUM('once', 'daily', 'weekly', 'monthly') NOT NULL DEFAULT 'once' AFTER pledged_amount;

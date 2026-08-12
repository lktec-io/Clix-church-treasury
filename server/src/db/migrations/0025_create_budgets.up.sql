-- "How much did we plan?" vs "how much actually happened?" — the actual
-- side always comes from the Financial Engine (transactions.repository.js
-- #sumByType), never recalculated here (docs/FINANCIAL_ARCHITECTURE.md §6).
-- `type` disambiguates what's being planned even when category_id is NULL
-- (a fund-level budget with no specific category breakdown).
CREATE TABLE budgets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  financial_period_id BIGINT UNSIGNED NOT NULL,
  fund_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  type ENUM('income', 'expense') NOT NULL,
  budget_amount DECIMAL(14, 2) NOT NULL,
  notes VARCHAR(500) NULL,
  status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_budgets_tenant_period_fund_category (tenant_id, financial_period_id, fund_id, category_id),
  KEY idx_budgets_tenant_period (tenant_id, financial_period_id),
  CONSTRAINT fk_budgets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_budgets_period FOREIGN KEY (financial_period_id) REFERENCES financial_periods (id) ON DELETE RESTRICT,
  CONSTRAINT fk_budgets_fund FOREIGN KEY (fund_id) REFERENCES funds (id) ON DELETE RESTRICT,
  CONSTRAINT fk_budgets_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT,
  CONSTRAINT fk_budgets_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_budgets_amount_non_negative CHECK (budget_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

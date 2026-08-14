-- Optional receipt/statement-level breakdown of a single contribution
-- (e.g. "Sadaka ya Kambi = 5,000" + "Ujenzi wa Kambi = 5,000" under one
-- 10,000 payment). Deliberately no category_id here: the parent
-- contribution's own category_id/amount remains the single source of
-- truth for the ledger, budget-vs-actual, and every other category-level
-- report — items are purpose labels that must sum to the parent's amount
-- (enforced in contributions.validator.js, not the DB), not independent
-- ledger postings. See docs/MASTER_TODO.md's member-portal plan for why.
CREATE TABLE contribution_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  contribution_id BIGINT UNSIGNED NOT NULL,
  purpose VARCHAR(150) NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_contribution_items_contribution (contribution_id),
  KEY idx_contribution_items_tenant (tenant_id),
  CONSTRAINT fk_contribution_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_contribution_items_contribution FOREIGN KEY (contribution_id) REFERENCES contributions (id) ON DELETE CASCADE,
  CONSTRAINT chk_contribution_items_amount_positive CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

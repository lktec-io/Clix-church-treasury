-- DOUBLE-ENTRY GENERAL LEDGER
--
-- ARCHITECTURE: `transactions` is NOT replaced. It remains the operational
-- cash/fund subsidiary ledger that every balance and report reads. This adds
-- the general ledger ALONGSIDE it — one balanced journal entry per posted
-- transaction, linked 1:1 — written inside the same DB transaction, from the
-- same values, by financialEngine.postLedgerEntry.
--
-- RESTORED. This file was at one point replaced with a copy of 0036's
-- remittance tables, so databases that applied that version never got the
-- ledger at all and every contribution failed with "Unknown column
-- 'transaction_id'" (the INSERT INTO journal_entries). The definitions below
-- are the originals, which are what journal.repository.js writes. Databases
-- that already applied the replacement are repaired by 0041; this file only
-- matters to databases that have not applied 0037 yet.
--
-- IDEMPOTENT: CREATE ... IF NOT EXISTS, and the two column additions check
-- INFORMATION_SCHEMA first, so a database that already has some of this
-- (created by hand, or by an edited migration) does not stop here.

-- Per-tenant chart of accounts. Seeded from db/seeds/chartOfAccountsTemplate.js
-- on tenant creation, and lazily on first posting for churches that predate it.
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  -- 1xxx asset, 2xxx liability, 3xxx equity, 4xxx revenue, 5xxx expense.
  -- Stored as text, never arithmetic.
  code VARCHAR(20) NOT NULL,
  name VARCHAR(150) NOT NULL,
  name_sw VARCHAR(150) NULL,
  account_type ENUM('asset', 'liability', 'equity', 'revenue', 'expense') NOT NULL,
  -- Which side increases this account; stored so posting rules read one
  -- column instead of re-deriving the convention at every call site.
  normal_balance ENUM('debit', 'credit') NOT NULL,
  -- The accounts the posting engine finds by role rather than by name
  -- ('cash', 'contribution_revenue', 'general_expense', ...). NULL for
  -- ordinary accounts a church adds itself.
  system_role VARCHAR(40) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_coa_tenant_code (tenant_id, code),
  -- At most one account per system role per tenant.
  UNIQUE KEY uq_coa_tenant_system_role (tenant_id, system_role),
  KEY idx_coa_tenant_type (tenant_id, account_type),
  CONSTRAINT fk_coa_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One header per posted transaction. Append-only, like the transaction it
-- mirrors — a correction posts a new reversing entry.
CREATE TABLE IF NOT EXISTS journal_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  transaction_id BIGINT UNSIGNED NOT NULL,
  financial_period_id BIGINT UNSIGNED NOT NULL,
  entry_date DATE NOT NULL,
  memo VARCHAR(500) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  -- 1:1 with the subsidiary ledger row: what makes the two sets of books
  -- impossible to double-post against each other.
  UNIQUE KEY uq_journal_entries_transaction (transaction_id),
  KEY idx_journal_entries_tenant_period (tenant_id, financial_period_id),
  CONSTRAINT fk_journal_entries_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_entries_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_entries_period FOREIGN KEY (financial_period_id) REFERENCES financial_periods (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The DR/CR rows. Debits must equal credits per entry — enforced in
-- journal.service.js before insert, since SQL cannot express a cross-row
-- CHECK. Separate debit/credit columns rather than one signed amount: it is
-- the form an auditor reads, and no sign convention can drift.
CREATE TABLE IF NOT EXISTS journal_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  journal_entry_id BIGINT UNSIGNED NOT NULL,
  coa_account_id BIGINT UNSIGNED NOT NULL,
  -- Fund dimension: "what does the Building Fund hold".
  fund_id BIGINT UNSIGNED NULL,
  debit DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  credit DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  description VARCHAR(500) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_journal_lines_entry (journal_entry_id),
  KEY idx_journal_lines_tenant_account (tenant_id, coa_account_id),
  CONSTRAINT fk_journal_lines_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_lines_entry FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON DELETE CASCADE,
  CONSTRAINT fk_journal_lines_account FOREIGN KEY (coa_account_id) REFERENCES chart_of_accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_lines_fund FOREIGN KEY (fund_id) REFERENCES funds (id) ON DELETE RESTRICT,
  -- One side or the other, never both and never neither.
  CONSTRAINT chk_journal_lines_one_side CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional per-row GL mapping. NULL = "use the system-role default", so every
-- existing account/category keeps working untouched.
SELECT COUNT(*) INTO @m37_acc_gl
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'accounts' AND column_name = 'gl_account_id';

SET @m37_sql := IF(@m37_acc_gl = 0,
  'ALTER TABLE accounts ADD COLUMN gl_account_id BIGINT UNSIGNED NULL, ADD CONSTRAINT fk_accounts_gl_account FOREIGN KEY (gl_account_id) REFERENCES chart_of_accounts (id) ON DELETE SET NULL',
  'DO 0');
PREPARE m37_stmt FROM @m37_sql;
EXECUTE m37_stmt;
DEALLOCATE PREPARE m37_stmt;

SELECT COUNT(*) INTO @m37_cat_gl
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'categories' AND column_name = 'gl_account_id';

SET @m37_sql := IF(@m37_cat_gl = 0,
  'ALTER TABLE categories ADD COLUMN gl_account_id BIGINT UNSIGNED NULL, ADD CONSTRAINT fk_categories_gl_account FOREIGN KEY (gl_account_id) REFERENCES chart_of_accounts (id) ON DELETE SET NULL',
  'DO 0');
PREPARE m37_stmt FROM @m37_sql;
EXECUTE m37_stmt;
DEALLOCATE PREPARE m37_stmt;

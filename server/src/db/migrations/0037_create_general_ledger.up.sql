-- DOUBLE-ENTRY GENERAL LEDGER
--
-- ARCHITECTURE, stated plainly because it determines how everything below
-- is read: `transactions` is NOT replaced. It remains the operational
-- cash/fund subsidiary ledger that every balance, report and existing test
-- already reads. This adds the general ledger ALONGSIDE it — one balanced
-- journal entry per posted transaction, linked 1:1 — which is the standard
-- subsidiary-ledger + GL arrangement.
--
-- Rewriting `transactions` into DR/CR pairs instead would have re-pointed
-- every balance query, every report and the reversal/transfer logic in one
-- change, with real money on the other side of any mistake. Layering gives
-- auditors the trial balance they require while the proven cash ledger keeps
-- answering "what is in the CRDB account" exactly as it does today. The two
-- are reconcilable by construction: both are written inside the same DB
-- transaction, from the same source values, in financialEngine.postLedgerEntry.

-- Per-tenant chart of accounts. Seeded from a standard template on tenant
-- creation (db/seeds/chartOfAccountsTemplate.js) and extendable per church.
CREATE TABLE chart_of_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  -- Conventional numeric coding: 1xxx asset, 2xxx liability, 3xxx equity,
  -- 4xxx revenue, 5xxx expense. Stored as text, never arithmetic.
  code VARCHAR(20) NOT NULL,
  name VARCHAR(150) NOT NULL,
  name_sw VARCHAR(150) NULL,
  account_type ENUM('asset', 'liability', 'equity', 'revenue', 'expense') NOT NULL,
  -- Which side increases this account. Set from account_type at seed time
  -- and stored rather than derived, so the posting rules read one column
  -- instead of re-deriving the convention at every call site.
  normal_balance ENUM('debit', 'credit') NOT NULL,
  -- Marks the handful of accounts the posting engine must be able to find
  -- by role rather than by name: 'cash', 'contribution_revenue',
  -- 'general_expense', 'transfer_clearing', 'remittance_payable',
  -- 'adjustment'. NULL for ordinary accounts a church adds itself.
  system_role VARCHAR(40) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_coa_tenant_code (tenant_id, code),
  -- At most one account per system role per tenant: the resolver must never
  -- have to choose between two candidates for "the cash account".
  UNIQUE KEY uq_coa_tenant_system_role (tenant_id, system_role),
  KEY idx_coa_tenant_type (tenant_id, account_type),
  CONSTRAINT fk_coa_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One header per posted transaction. Append-only, exactly like the
-- transaction it mirrors — a correction posts a new reversing entry rather
-- than editing this one.
CREATE TABLE journal_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  transaction_id BIGINT UNSIGNED NOT NULL,
  financial_period_id BIGINT UNSIGNED NOT NULL,
  entry_date DATE NOT NULL,
  memo VARCHAR(500) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  -- 1:1 with the subsidiary ledger row. This uniqueness is what makes the
  -- two sets of books impossible to double-post against each other.
  UNIQUE KEY uq_journal_entries_transaction (transaction_id),
  KEY idx_journal_entries_tenant_period (tenant_id, financial_period_id),
  CONSTRAINT fk_journal_entries_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_entries_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_entries_period FOREIGN KEY (financial_period_id) REFERENCES financial_periods (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The DR/CR rows. Two or more per entry, and their debits must equal their
-- credits — enforced in journal.service.js before insert, since SQL cannot
-- express a cross-row CHECK.
--
-- Separate debit/credit columns rather than one signed amount: it is the
-- form an auditor reads, it makes the balance assertion a plain SUM
-- comparison, and it removes any chance of a sign convention being applied
-- inconsistently between the posting code and a report.
CREATE TABLE journal_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  journal_entry_id BIGINT UNSIGNED NOT NULL,
  coa_account_id BIGINT UNSIGNED NOT NULL,
  -- Carried for fund accounting: a trial balance is by GL account, but a
  -- church also needs "what does the Building Fund hold", which is a fund
  -- dimension on the same rows.
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
  -- A line is one side or the other, never both and never neither. This is
  -- the single most common data error in a hand-rolled GL.
  CONSTRAINT chk_journal_lines_one_side CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional per-row GL mapping. NULL means "use the system-role default",
-- so every existing account/category keeps working untouched and a church
-- can refine the mapping later without a migration.
ALTER TABLE accounts
  ADD COLUMN gl_account_id BIGINT UNSIGNED NULL AFTER type,
  ADD CONSTRAINT fk_accounts_gl_account FOREIGN KEY (gl_account_id) REFERENCES chart_of_accounts (id) ON DELETE SET NULL;

ALTER TABLE categories
  ADD COLUMN gl_account_id BIGINT UNSIGNED NULL AFTER report_group,
  ADD CONSTRAINT fk_categories_gl_account FOREIGN KEY (gl_account_id) REFERENCES chart_of_accounts (id) ON DELETE SET NULL;

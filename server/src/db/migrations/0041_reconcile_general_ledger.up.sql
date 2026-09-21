-- RECONCILE THE GENERAL LEDGER SCHEMA WITH THE CODE.
--
-- WHY THIS EXISTS. The migration files for 0037 and 0039 were edited after
-- they were written, and the edited versions were applied to production:
--
--   0037 was meant to create chart_of_accounts, journal_entries and
--        journal_lines and add accounts/categories.gl_account_id. The applied
--        version created none of them (it re-created 0036's remittance
--        tables instead).
--   0039 was meant to add contributions.fee_transaction_id with its foreign
--        key and index, and seed the Makato expense category. The applied
--        version did neither.
--   The journal tables were then created by hand with a DIFFERENT design
--        (reference_type/narration on the header; entry_id/account_id/
--        amount/entry_type on the lines) from the one the posting code
--        writes (transaction_id/entry_date/memo; journal_entry_id/
--        coa_account_id/debit/credit).
--
-- schema_migrations records all of them as applied, so `npm run migrate`
-- reports nothing to do while every contribution fails with
--   Unknown column 'transaction_id' in 'field list'
-- which is the INSERT INTO journal_entries, not the contributions table.
--
-- WHAT THIS DOES. Brings any database, in any of the states above, to the
-- schema the code expects. Every step inspects INFORMATION_SCHEMA and acts
-- only when needed, so it is a no-op on a correct database and safe to run
-- again if it is interrupted. (MySQL commits each DDL statement on its own,
-- so an interrupted run keeps what it finished; re-running resumes.)
--
-- THE ONE DESTRUCTIVE STEP, AND ITS GUARD. Wrongly-shaped journal tables are
-- dropped and recreated. That is only done when BOTH are empty — which they
-- must be, because the code has never been able to write a row into them.
-- If either holds data this migration STOPS before touching anything, with
-- an error naming the problem; that data was written by something other
-- than this application and needs a person to decide what it is.
--
-- Written as single statements with conditional work done through PREPARE,
-- because migrate.js splits files on semicolons and cannot run a stored
-- procedure. Variables are prefixed @m41_ so nothing collides with another
-- migration on the same connection.


-- ---------------------------------------------------------------------------
-- 1. Inspect the journal tables.
-- ---------------------------------------------------------------------------

SELECT COUNT(*) INTO @m41_je_exists
  FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_name = 'journal_entries';

SELECT COUNT(*) INTO @m41_jl_exists
  FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_name = 'journal_lines';

-- The header is the right shape when it links to its transaction.
SELECT COUNT(*) INTO @m41_je_ok
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'journal_entries'
   AND column_name IN ('transaction_id', 'entry_date', 'memo');

-- The lines are the right shape when they carry separate debit/credit
-- columns against a chart-of-accounts row.
SELECT COUNT(*) INTO @m41_jl_ok
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'journal_lines'
   AND column_name IN ('journal_entry_id', 'coa_account_id', 'fund_id', 'debit', 'credit');

SET @m41_ledger_wrong := (@m41_je_exists = 1 AND @m41_je_ok < 3)
                      OR (@m41_jl_exists = 1 AND @m41_jl_ok < 5);

-- Row counts, only for tables that exist (a SELECT against a missing table
-- is a parse error, so the query itself has to be conditional).
SET @m41_sql := IF(@m41_je_exists = 1, 'SELECT COUNT(*) INTO @m41_je_rows FROM journal_entries', 'SET @m41_je_rows := 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;

SET @m41_sql := IF(@m41_jl_exists = 1, 'SELECT COUNT(*) INTO @m41_jl_rows FROM journal_lines', 'SET @m41_jl_rows := 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;


-- ---------------------------------------------------------------------------
-- 2. The guard. Wrong shape AND data present -> stop, change nothing.
--    The deliberately missing table name IS the error message MySQL prints.
-- ---------------------------------------------------------------------------

SET @m41_sql := IF(@m41_ledger_wrong AND (@m41_je_rows + @m41_jl_rows) > 0,
  'SELECT 1 FROM `STOP_0041_journal_tables_wrong_shape_and_not_empty`',
  'DO 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;


-- ---------------------------------------------------------------------------
-- 3. Replace wrongly-shaped (and, by the guard above, empty) journal tables.
--    Lines first: they hold the foreign key to the header.
-- ---------------------------------------------------------------------------

SET @m41_sql := IF(@m41_ledger_wrong, 'DROP TABLE IF EXISTS journal_lines', 'DO 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;

SET @m41_sql := IF(@m41_ledger_wrong, 'DROP TABLE IF EXISTS journal_entries', 'DO 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;


-- ---------------------------------------------------------------------------
-- 4. Create what is missing, in the shape the code writes.
--    Identical to the original 0037 definitions.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(150) NOT NULL,
  name_sw VARCHAR(150) NULL,
  account_type ENUM('asset', 'liability', 'equity', 'revenue', 'expense') NOT NULL,
  normal_balance ENUM('debit', 'credit') NOT NULL,
  system_role VARCHAR(40) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_coa_tenant_code (tenant_id, code),
  UNIQUE KEY uq_coa_tenant_system_role (tenant_id, system_role),
  KEY idx_coa_tenant_type (tenant_id, account_type),
  CONSTRAINT fk_coa_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS journal_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  transaction_id BIGINT UNSIGNED NOT NULL,
  financial_period_id BIGINT UNSIGNED NOT NULL,
  entry_date DATE NOT NULL,
  memo VARCHAR(500) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_journal_entries_transaction (transaction_id),
  KEY idx_journal_entries_tenant_period (tenant_id, financial_period_id),
  CONSTRAINT fk_journal_entries_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_entries_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_entries_period FOREIGN KEY (financial_period_id) REFERENCES financial_periods (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS journal_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  journal_entry_id BIGINT UNSIGNED NOT NULL,
  coa_account_id BIGINT UNSIGNED NOT NULL,
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
  CONSTRAINT chk_journal_lines_one_side CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- chart_of_accounts is NEVER dropped: by now it can hold the 5300 Makato
-- rows 0039 inserted and whatever the lazy seed created. If it exists but
-- lacks a column the posting code reads, stop and say so.
SELECT COUNT(*) INTO @m41_coa_ok
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'chart_of_accounts'
   AND column_name IN ('code', 'name', 'name_sw', 'account_type', 'normal_balance', 'system_role', 'is_active');

SET @m41_sql := IF(@m41_coa_ok < 7,
  'SELECT 1 FROM `STOP_0041_chart_of_accounts_missing_columns`',
  'DO 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;


-- ---------------------------------------------------------------------------
-- 5. chart_of_accounts, if it was created by the edited 0039: that version
--    lacks the one-account-per-system-role key. Added only when no tenant
--    already has two accounts claiming the same role (adding the key would
--    fail, and choosing which to keep is a person's decision).
-- ---------------------------------------------------------------------------

SELECT COUNT(*) INTO @m41_coa_role_key
  FROM information_schema.statistics
 WHERE table_schema = DATABASE() AND table_name = 'chart_of_accounts'
   AND index_name = 'uq_coa_tenant_system_role';

SELECT COUNT(*) INTO @m41_coa_role_dupes
  FROM (
    SELECT tenant_id, system_role
      FROM chart_of_accounts
     WHERE system_role IS NOT NULL
     GROUP BY tenant_id, system_role
    HAVING COUNT(*) > 1
  ) AS dupes;

SET @m41_sql := IF(@m41_coa_role_key = 0 AND @m41_coa_role_dupes = 0,
  'ALTER TABLE chart_of_accounts ADD UNIQUE KEY uq_coa_tenant_system_role (tenant_id, system_role)',
  'DO 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;


-- ---------------------------------------------------------------------------
-- 6. Optional GL mapping columns on accounts and categories (from 0037).
--    NULL means "use the system-role default", so adding them changes no
--    existing posting.
-- ---------------------------------------------------------------------------

SELECT COUNT(*) INTO @m41_acc_gl
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'accounts' AND column_name = 'gl_account_id';

SET @m41_sql := IF(@m41_acc_gl = 0,
  'ALTER TABLE accounts ADD COLUMN gl_account_id BIGINT UNSIGNED NULL, ADD CONSTRAINT fk_accounts_gl_account FOREIGN KEY (gl_account_id) REFERENCES chart_of_accounts (id) ON DELETE SET NULL',
  'DO 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;

SELECT COUNT(*) INTO @m41_cat_gl
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'categories' AND column_name = 'gl_account_id';

SET @m41_sql := IF(@m41_cat_gl = 0,
  'ALTER TABLE categories ADD COLUMN gl_account_id BIGINT UNSIGNED NULL, ADD CONSTRAINT fk_categories_gl_account FOREIGN KEY (gl_account_id) REFERENCES chart_of_accounts (id) ON DELETE SET NULL',
  'DO 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;


-- ---------------------------------------------------------------------------
-- 7. contributions.fee_transaction_id (from 0039): column, index, foreign key.
--    Each checked separately, because a hand-applied fix may have added the
--    column without the other two.
-- ---------------------------------------------------------------------------

SELECT COUNT(*) INTO @m41_fee_col
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'contributions' AND column_name = 'fee_transaction_id';

SET @m41_sql := IF(@m41_fee_col = 0,
  'ALTER TABLE contributions ADD COLUMN fee_transaction_id BIGINT UNSIGNED NULL',
  'DO 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;

-- Any index LEADING with the column will do; a second one would be waste.
SELECT COUNT(*) INTO @m41_fee_idx
  FROM information_schema.statistics
 WHERE table_schema = DATABASE() AND table_name = 'contributions'
   AND column_name = 'fee_transaction_id' AND seq_in_index = 1;

SET @m41_sql := IF(@m41_fee_idx = 0,
  'CREATE INDEX idx_contributions_fee_transaction ON contributions (fee_transaction_id)',
  'DO 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;

-- Any foreign key from this column to transactions will do, whatever it was
-- named — a hand-added one must not end up duplicated under a second name.
SELECT COUNT(*) INTO @m41_fee_fk
  FROM information_schema.key_column_usage
 WHERE table_schema = DATABASE() AND table_name = 'contributions'
   AND column_name = 'fee_transaction_id' AND referenced_table_name = 'transactions';

SET @m41_sql := IF(@m41_fee_fk = 0,
  'ALTER TABLE contributions ADD CONSTRAINT fk_contributions_fee_transaction FOREIGN KEY (fee_transaction_id) REFERENCES transactions (id) ON DELETE SET NULL',
  'DO 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;


-- ---------------------------------------------------------------------------
-- 8. contributions.transaction_id back to NOT NULL.
--
--    It has been NOT NULL since 0019: every contribution IS a ledger posting,
--    and a contribution with no transaction is money recorded nowhere. If it
--    was loosened to NULL by hand while debugging, restore it — but only when
--    no row actually depends on the loosening, so this can never fail and
--    never discard anything. A NULL row, if one exists, is left for a person.
-- ---------------------------------------------------------------------------

SELECT COUNT(*) INTO @m41_txn_nullable
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'contributions'
   AND column_name = 'transaction_id' AND is_nullable = 'YES';

SELECT COUNT(*) INTO @m41_txn_nulls FROM contributions WHERE transaction_id IS NULL;

SET @m41_sql := IF(@m41_txn_nullable = 1 AND @m41_txn_nulls = 0,
  'ALTER TABLE contributions MODIFY transaction_id BIGINT UNSIGNED NOT NULL',
  'DO 0');
PREPARE m41_stmt FROM @m41_sql;
EXECUTE m41_stmt;
DEALLOCATE PREPARE m41_stmt;


-- ---------------------------------------------------------------------------
-- 9. Makato seed data (from 0039). The GL account per church, then the
--    expense category mapped to it. The code also creates both on first use,
--    so this only saves the first Makato contribution a lookup.
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO chart_of_accounts
  (tenant_id, code, name, name_sw, account_type, normal_balance, system_role, is_active, created_at, updated_at)
SELECT t.id, '5300', 'Mobile Money Fees (Makato)', 'Makato ya Pesa kwa Simu', 'expense', 'debit',
       'mobile_money_fees', TRUE, UTC_TIMESTAMP(), UTC_TIMESTAMP()
  FROM tenants t;

INSERT INTO categories (tenant_id, type, name, gl_account_id, is_active, created_at, updated_at)
SELECT t.id, 'expense', 'Makato (Mobile Money Fees)', coa.id, TRUE, UTC_TIMESTAMP(), UTC_TIMESTAMP()
  FROM tenants t
  LEFT JOIN chart_of_accounts coa
    ON coa.tenant_id = t.id AND coa.system_role = 'mobile_money_fees'
 WHERE NOT EXISTS (
   SELECT 1 FROM categories c
    WHERE c.tenant_id = t.id AND c.type = 'expense' AND c.name = 'Makato (Mobile Money Fees)'
 );

-- A Makato category the code created on first use has no GL mapping yet.
UPDATE categories c
  JOIN chart_of_accounts coa
    ON coa.tenant_id = c.tenant_id AND coa.system_role = 'mobile_money_fees'
   SET c.gl_account_id = coa.id
 WHERE c.type = 'expense'
   AND c.name = 'Makato (Mobile Money Fees)'
   AND c.gl_account_id IS NULL;

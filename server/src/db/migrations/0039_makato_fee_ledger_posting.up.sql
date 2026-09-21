-- MAKATO (mobile-money agent fee) LEDGER POSTING
--
-- A fee greater than zero on a contribution posts its own expense
-- transaction (contributions.service.js#postMakatoFee), so the account
-- balance shows what actually arrived:
--
--   income  10,000  DR Cash/Bank         CR Contributions Revenue
--   expense    500  DR Mobile Money Fees CR Cash/Bank
--
-- This migration adds the GL account (5300) and expense category those
-- postings use, and the contributions.fee_transaction_id link from a
-- contribution to its fee posting.
--
-- It deliberately does NOT back-post fees recorded before it: those were
-- never deducted from any balance, and inventing entries for them now would
-- change historical balances without anyone deciding to.
--
-- RESTORED. This file was at one point edited down to only the 5300 row,
-- losing the fee_transaction_id column the posting code writes — the cause
-- of "Unknown column 'c.fee_transaction_id'". Databases that applied the
-- edited version are repaired by 0041.
--
-- IDEMPOTENT: every step checks before it acts.

INSERT IGNORE INTO chart_of_accounts
  (tenant_id, code, name, name_sw, account_type, normal_balance, system_role, is_active, created_at, updated_at)
SELECT t.id, '5300', 'Mobile Money Fees (Makato)', 'Makato ya Pesa kwa Simu', 'expense', 'debit',
       'mobile_money_fees', TRUE, UTC_TIMESTAMP(), UTC_TIMESTAMP()
  FROM tenants t;

INSERT INTO categories (tenant_id, type, name, gl_account_id, is_active, created_at, updated_at)
SELECT t.id, 'expense', 'Makato (Mobile Money Fees)', coa.id, TRUE, UTC_TIMESTAMP(), UTC_TIMESTAMP()
  FROM tenants t
  JOIN chart_of_accounts coa
    ON coa.tenant_id = t.id
   AND coa.system_role = 'mobile_money_fees'
 WHERE NOT EXISTS (
   SELECT 1 FROM categories c
    WHERE c.tenant_id = t.id AND c.type = 'expense' AND c.name = 'Makato (Mobile Money Fees)'
 );

SELECT COUNT(*) INTO @m39_fee_col
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'contributions' AND column_name = 'fee_transaction_id';

SET @m39_sql := IF(@m39_fee_col = 0,
  'ALTER TABLE contributions ADD COLUMN fee_transaction_id BIGINT UNSIGNED NULL AFTER transfer_fee',
  'DO 0');
PREPARE m39_stmt FROM @m39_sql;
EXECUTE m39_stmt;
DEALLOCATE PREPARE m39_stmt;

SELECT COUNT(*) INTO @m39_fee_idx
  FROM information_schema.statistics
 WHERE table_schema = DATABASE() AND table_name = 'contributions'
   AND column_name = 'fee_transaction_id' AND seq_in_index = 1;

SET @m39_sql := IF(@m39_fee_idx = 0,
  'CREATE INDEX idx_contributions_fee_transaction ON contributions (fee_transaction_id)',
  'DO 0');
PREPARE m39_stmt FROM @m39_sql;
EXECUTE m39_stmt;
DEALLOCATE PREPARE m39_stmt;

SELECT COUNT(*) INTO @m39_fee_fk
  FROM information_schema.key_column_usage
 WHERE table_schema = DATABASE() AND table_name = 'contributions'
   AND column_name = 'fee_transaction_id' AND referenced_table_name = 'transactions';

SET @m39_sql := IF(@m39_fee_fk = 0,
  'ALTER TABLE contributions ADD CONSTRAINT fk_contributions_fee_transaction FOREIGN KEY (fee_transaction_id) REFERENCES transactions (id) ON DELETE SET NULL',
  'DO 0');
PREPARE m39_stmt FROM @m39_sql;
EXECUTE m39_stmt;
DEALLOCATE PREPARE m39_stmt;

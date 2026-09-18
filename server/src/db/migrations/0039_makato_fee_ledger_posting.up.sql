-- MAKATO (mobile-money agent fees) BECOME REAL LEDGER ENTRIES.
--
-- Migration 0038 recorded the agent fee beside the contribution as metadata
-- only: the ledger saw the gross amount the member sent, so a cash/mobile
-- account's balance was overstated by every fee an agent had already taken.
--
-- From here a fee is posted as its own EXPENSE transaction (and its own
-- balanced journal pair) against the same account and fund as the
-- contribution it belongs to:
--
--   income  10,000  DR Cash/Bank            CR Contributions Revenue
--   expense    500  DR Mobile Money Fees    CR Cash/Bank
--   -------------------------------------------------------------
--   account balance moves by 9,500 — the amount that actually arrived.
--
-- The contribution's own `amount` still holds the FULL amount the member
-- gave: their statement must show what they gave, not what the agent left.

-- 1. The expense account the fee posts to. `system_role` is how the posting
--    engine resolves it (journal.service.js), so a church may rename or
--    recode the account without breaking posting. INSERT IGNORE against
--    uq_coa_tenant_code, so this is safe for tenants whose chart of accounts
--    was already seeded, and a no-op for those seeded later from the
--    template (which now carries the same row).
INSERT IGNORE INTO chart_of_accounts
  (tenant_id, code, name, name_sw, account_type, normal_balance, system_role, is_active, created_at, updated_at)
SELECT t.id, '5300', 'Mobile Money Fees (Makato)', 'Makato ya Pesa kwa Simu', 'expense', 'debit',
       'mobile_money_fees', TRUE, UTC_TIMESTAMP(), UTC_TIMESTAMP()
  FROM tenants t;

-- 2. The operational expense category the fee transaction carries, mapped to
--    the GL account above. Named in both languages the way the rest of the
--    product names Makato, and seeded per tenant so the expense reports group
--    fees on their own line instead of burying them in General Expenses.
INSERT IGNORE INTO categories (tenant_id, type, name, gl_account_id, is_active, created_at, updated_at)
SELECT t.id, 'expense', 'Makato (Mobile Money Fees)', coa.id, TRUE, UTC_TIMESTAMP(), UTC_TIMESTAMP()
  FROM tenants t
  JOIN chart_of_accounts coa
    ON coa.tenant_id = t.id
   AND coa.system_role = 'mobile_money_fees';

-- 3. The link from a contribution to the fee transaction posted for it.
--    NULL means "no fee on this contribution", which is every row recorded
--    before this migration and every non-mobile-money gift after it.
--    ON DELETE SET NULL, never CASCADE: a posted ledger row is append-only
--    and must not be removable through a domain record.
ALTER TABLE contributions
  ADD COLUMN fee_transaction_id BIGINT UNSIGNED NULL AFTER transfer_fee,
  ADD CONSTRAINT fk_contributions_fee_transaction
    FOREIGN KEY (fee_transaction_id) REFERENCES transactions (id) ON DELETE SET NULL;

CREATE INDEX idx_contributions_fee_transaction ON contributions (fee_transaction_id);

-- NOTE ON HISTORY: fees recorded before this migration keep their
-- transfer_fee value and stay unposted (fee_transaction_id IS NULL). They
-- are NOT back-posted here — writing ledger entries into closed financial
-- periods from a migration would restate books a treasurer has already
-- signed off. The dashboard reports posted and unposted fee totals
-- separately so the difference is visible rather than silently merged.

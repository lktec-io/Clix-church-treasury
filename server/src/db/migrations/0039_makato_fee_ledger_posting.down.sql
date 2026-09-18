-- Reverses 0039. The posted fee TRANSACTIONS are deliberately left alone:
-- they are real, balanced ledger entries, and deleting posted rows from a
-- down-migration would leave the general ledger unbalanced. Only the link
-- column and the seeded reference data go.

DROP INDEX idx_contributions_fee_transaction ON contributions;

ALTER TABLE contributions
  DROP FOREIGN KEY fk_contributions_fee_transaction,
  DROP COLUMN fee_transaction_id;

-- Only removable while nothing has posted against them; a category or GL
-- account still referenced by a transaction or journal line stays, and the
-- DELETE simply matches no rows for that tenant.
DELETE c FROM categories c
 WHERE c.type = 'expense'
   AND c.name = 'Makato (Mobile Money Fees)'
   AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.category_id = c.id);

DELETE coa FROM chart_of_accounts coa
 WHERE coa.system_role = 'mobile_money_fees'
   AND NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.coa_account_id = coa.id);

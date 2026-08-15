-- Prevents a double-click, a slow network retry, or a treasurer resubmitting
-- after an ambiguous timeout from ever creating two ledger-posted
-- contributions for what was really one payment. The frontend generates a
-- fresh random key per form-fill (ContributionsPage.jsx) and sends it with
-- the create request; contributions.service.js#recordContribution checks
-- for an existing row with the same (tenant_id, idempotency_key) before
-- doing any financial work, and the UNIQUE index is the hard backstop
-- against two truly simultaneous requests racing past that check.
-- NULL is deliberately allowed and excluded from the uniqueness
-- requirement (MySQL treats every NULL as distinct in a UNIQUE index) so
-- contributions created without a key (older clients, API integrations)
-- are entirely unaffected.
ALTER TABLE contributions
  ADD COLUMN idempotency_key VARCHAR(100) NULL AFTER reference,
  ADD UNIQUE KEY uq_contributions_tenant_idempotency (tenant_id, idempotency_key);

ALTER TABLE contributions
  DROP KEY uq_contributions_tenant_idempotency,
  DROP COLUMN idempotency_key;

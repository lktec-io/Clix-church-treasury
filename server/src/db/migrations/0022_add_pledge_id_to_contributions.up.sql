-- Links a contribution to the pledge it fulfills, per docs/FINANCIAL_ARCHITECTURE.md
-- §7: a pledge payment is just a contribution, recorded through the existing
-- Phase 4 system, with this one extra reference. No separate pledge-payment
-- ledger logic exists or is needed.
ALTER TABLE contributions
  ADD COLUMN pledge_id BIGINT UNSIGNED NULL AFTER contributor_id,
  ADD KEY idx_contributions_tenant_pledge (tenant_id, pledge_id),
  ADD CONSTRAINT fk_contributions_pledge FOREIGN KEY (pledge_id) REFERENCES pledges (id) ON DELETE RESTRICT;

ALTER TABLE contributions
  DROP FOREIGN KEY fk_contributions_pledge,
  DROP KEY idx_contributions_tenant_pledge,
  DROP COLUMN pledge_id;

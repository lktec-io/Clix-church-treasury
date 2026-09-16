ALTER TABLE pledges DROP COLUMN frequency;

ALTER TABLE contributors
  DROP COLUMN id_note,
  DROP COLUMN id_number,
  DROP COLUMN id_type;

ALTER TABLE contributions
  DROP FOREIGN KEY fk_contributions_department,
  DROP CHECK chk_contributions_transfer_fee,
  DROP KEY idx_contributions_tenant_department,
  DROP COLUMN transfer_fee,
  DROP COLUMN mobile_provider,
  DROP COLUMN department_id;

DROP TABLE IF EXISTS departments;

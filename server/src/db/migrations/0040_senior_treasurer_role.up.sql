-- SENIOR TREASURER (Mhazini Mkuu) — a system role that may BOTH approve an
-- expense and mark it paid.
--
-- The seed script (seedRbacCatalog.js) creates this role on a fresh install.
-- This migration exists for databases that already exist: `npm run seed` is
-- not part of a normal deploy, so without it an upgraded church would have
-- the new approval rules in the code and no role that satisfies them —
-- nobody but the Super Administrator could approve anything.
--
-- Idempotent throughout (INSERT ... SELECT ... WHERE NOT EXISTS), so it is
-- safe next to the seed script and safe to re-run.
--
-- Grants are expressed by NAME and only for permissions that already exist
-- in this database, so a server that has not yet applied a later migration
-- adding a permission simply does not grant that one.

INSERT INTO roles (tenant_id, name, description, is_system, created_at, updated_at)
SELECT NULL,
       'Senior Treasurer',
       'Mhazini Mkuu — everything a Treasurer can do, plus authority to approve and reject expenses.',
       TRUE,
       UTC_TIMESTAMP(),
       UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE tenant_id IS NULL AND name = 'Senior Treasurer'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.name IN (
      'dashboard.view',
      'income.view', 'income.create', 'income.update', 'income.reverse',
      'contributors.view', 'contributors.manage',
      'expense.view', 'expense.create', 'expense.update', 'expense.submit',
      'expense.approve', 'expense.reject', 'expense.pay',
      'accounts.view', 'accounts.manage',
      'funds.view', 'funds.manage',
      'categories.manage',
      'transfers.create',
      'pledges.view', 'pledges.create',
      'receipts.view',
      'reports.view', 'reports.export',
      'budget.view', 'budget.manage',
      'financial_period.view', 'financial_period.manage', 'financial_period.close',
      'remittance.view', 'remittance.pay'
    )
 WHERE r.tenant_id IS NULL
   AND r.name = 'Senior Treasurer'
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );

-- Removes the Senior Treasurer role — but ONLY while nobody holds it.
--
-- user_roles.role_id is ON DELETE CASCADE, so an unconditional DELETE here
-- would not fail: it would quietly strip the role from every user who has
-- it and revoke their approval authority with no error and no record. The
-- NOT EXISTS clause makes this roll back cleanly on a database where the
-- role was never assigned, and do NOTHING on one where it was.
--
-- If the role survives this migration, that is the guard working. Reassign
-- the users who hold it, then run the rollback again.
--
-- (Written as plain statements on purpose: migrate.js splits files on
-- semicolons, so a stored procedure or DELIMITER block would be shredded
-- into fragments and fail.)

DELETE rp
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
 WHERE r.tenant_id IS NULL
   AND r.name = 'Senior Treasurer'
   AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.role_id = r.id);

DELETE r
  FROM roles r
 WHERE r.tenant_id IS NULL
   AND r.name = 'Senior Treasurer'
   AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.role_id = r.id);

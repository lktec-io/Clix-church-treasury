-- Clix Church Treasury Management System
-- Template for local development database setup.
-- Copy this file to setup-db.sql, replace CHANGE_ME_LOCAL_DEV_PASSWORD with a
-- real generated password, then run it once as MySQL root:
--
--   & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p < "server\scripts\setup-db.sql"
--
-- setup-db.sql is gitignored (it contains a real credential) — this template is the
-- committed reference every developer copies from.

CREATE DATABASE IF NOT EXISTS clix_treasury_dev
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS clix_treasury_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Application user: only DML + DDL needed to run migrations and serve the app.
-- No SUPER, no access to other databases, no GRANT OPTION.
CREATE USER IF NOT EXISTS 'clix_app'@'localhost' IDENTIFIED BY 'CHANGE_ME_LOCAL_DEV_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP
  ON clix_treasury_dev.* TO 'clix_app'@'localhost';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP
  ON clix_treasury_test.* TO 'clix_app'@'localhost';

FLUSH PRIVILEGES;

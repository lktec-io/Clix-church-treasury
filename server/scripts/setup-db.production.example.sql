-- Clix Church Treasury Management System — PRODUCTION database setup template.
--
-- Run this ONCE, manually, as MySQL root, directly on the production host
-- (e.g. `mysql -u root -p < setup-db.production.sql`) — never automated,
-- never committed with a real password filled in.
--
-- Copy this file to setup-db.production.sql, replace
-- CHANGE_ME_STRONG_GENERATED_PASSWORD with a real generated secret
-- (e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`),
-- run it, then put that same password in server/.env as DB_PASSWORD on the
-- production host — nowhere else, never in source control
-- (docs/DEVELOPMENT_RULES.md §3).
--
-- The application must NEVER run as MySQL root — see docs/MASTER_TODO.md
-- Phase 12 §12.7. This user gets exactly the privileges the app's own
-- migration runner and query layer need on its own database, nothing more:
-- no SUPER, no access to any other database on this instance, no GRANT OPTION.

CREATE DATABASE IF NOT EXISTS clix_treasury_production
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 'localhost' — the app and MySQL run on the same VPS in this architecture
-- (docs/PROJECT_ARCHITECTURE.md). If the database is ever moved to a
-- separate host, change this to that host's specific IP — never '%' (that
-- would accept a connection attempt as this user from anywhere on the network).
CREATE USER IF NOT EXISTS 'clix_app'@'localhost' IDENTIFIED BY 'CHANGE_ME_STRONG_GENERATED_PASSWORD';

-- CREATE/ALTER/INDEX/DROP are required because the app's own migration
-- runner (server/src/db/migrate.js) applies schema changes as this same
-- user — there is no separate, more-privileged "migration user" in this
-- architecture. DROP is scoped to this one database only, and is what
-- backs `npm run migrate:down` as a real rollback capability, not just
-- forward-only migrations.
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP
  ON clix_treasury_production.* TO 'clix_app'@'localhost';

FLUSH PRIVILEGES;

-- Next steps (see docs/DEPLOYMENT.md for the full walkthrough):
--   1. cd server && npm run migrate   (applies every migration in
--      server/src/db/migrations/ — 0001 through the latest, in order)
--   2. npm run seed                    (seeds the permission catalog +
--      system roles — required before any tenant can register; the dev
--      demo tenant/church is skipped automatically when NODE_ENV=production,
--      see server/src/db/seeds/run.js)
--   3. Verify: connect as clix_app and confirm `SHOW TABLES` lists every
--      table through `schema_migrations`, and `SELECT COUNT(*) FROM
--      permissions` returns the full seeded catalog (36 as of Phase 11).
--   4. The first real tenant is created by an admin visiting the app and
--      using the church registration flow (POST /auth/register-tenant) —
--      there is no separate "create the first church" CLI step.

// Production bootstrap for the FIRST Platform Administrator — the one
// account that must exist before anyone can ever reach /platform, since
// every /platform/* route requires the platform.manage permission and
// nothing in the product itself can grant that permission to a user who
// doesn't already have it (correctly — see permissionCatalog.js's
// PLATFORM_ONLY_PERMISSIONS: no tenant role, including "ALL", ever
// includes it). This is the one intentional manual escape hatch.
//
// Reuses the EXISTING authentication architecture end to end — no second
// auth system, no separate password store:
//   - the same seedRbacCatalog() every other permission/role goes through
//   - the same tenants.service.js#createTenantWithConnection
//     platform.service.js#createTenant itself builds on
//   - the same usersRepository.create() + bcrypt hashing every user in
//     this app is created with
//   - the same Platform Administrator system role platform.service.js
//     already assigns when a platform admin creates a tenant
//
// Credentials are NEVER hardcoded here and NEVER logged — they come from
// environment variables the operator sets for this one invocation only:
//
//   PLATFORM_ADMIN_EMAIL       (required)
//   PLATFORM_ADMIN_PASSWORD    (required, same 10-char minimum as every
//                                other password in this app)
//   PLATFORM_ADMIN_FULL_NAME   (optional, defaults to "Platform Administrator")
//
// Idempotent: running it twice never creates a duplicate account. If the
// email already exists (in the dedicated platform-admin tenant this
// script manages), it ensures that user holds the Platform Administrator
// role and stops — it never overwrites an existing password (use
// scripts/grantPlatformAdmin.js's sibling reset flow, or the product's
// own "reset password" action once you can log in, for that).
//
// Usage (from server/, with real production .env already in place):
//   PLATFORM_ADMIN_EMAIL=owner@clixworks.co.tz \
//   PLATFORM_ADMIN_PASSWORD='a real, strong, private password' \
//   PLATFORM_ADMIN_FULL_NAME='Leonard' \
//   npm run bootstrap:platform-admin
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../src/config/db.js';
import { seedRbacCatalog } from '../src/db/seeds/seedRbacCatalog.js';
import { tenantsRepository } from '../src/modules/tenants/tenants.repository.js';
import { createTenantWithConnection } from '../src/modules/tenants/tenants.service.js';
import { usersRepository } from '../src/modules/users/users.repository.js';
import { rolesRepository } from '../src/modules/roles/roles.repository.js';
import { userRolesRepository } from '../src/modules/roles/userRoles.repository.js';
import { validateEmail, validatePassword } from '../src/modules/auth/auth.validator.js';

const BCRYPT_COST = 10;
// A dedicated internal tenant that only ever holds platform-admin
// accounts — never a real church. Fixed slug so this script is safe to
// re-run: it finds the same tenant every time instead of creating a new
// one, which is what makes the whole script idempotent end to end.
const PLATFORM_TENANT_SLUG = 'clix-platform';
const PLATFORM_TENANT_NAME = 'Clix Platform (internal)';

function fail(message) {
  console.error(`[bootstrap-platform-admin] ${message}`);
  process.exit(1);
}

const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.PLATFORM_ADMIN_PASSWORD;
const fullName = process.env.PLATFORM_ADMIN_FULL_NAME?.trim() || 'Platform Administrator';

if (!email) fail('PLATFORM_ADMIN_EMAIL is required (set it for this one command, never hardcode it).');
try {
  validateEmail(email);
} catch {
  fail(`PLATFORM_ADMIN_EMAIL is not a valid email address.`);
}
if (!password) fail('PLATFORM_ADMIN_PASSWORD is required (set it for this one command, never hardcode it).');
try {
  validatePassword(password);
} catch {
  fail('PLATFORM_ADMIN_PASSWORD must be at least 10 characters — the same rule every password in this app follows.');
}

// Everything from here on touches the database — wrapped so a connection
// failure (wrong/stale local credentials, unreachable host, etc.) reports
// as one clear line and a non-zero exit, the same as the validation
// failures above, never a raw stack trace and never a false success.
try {
  console.log('[bootstrap-platform-admin] Ensuring the RBAC catalog is seeded (platform.manage + Platform Administrator role)...');
  const { permissionCount, roleCount } = await seedRbacCatalog();
  console.log(`[bootstrap-platform-admin] Seed OK — ${permissionCount} permissions, ${roleCount} roles confirmed present.`);

  const result = await withTransaction(async (connection) => {
    let tenant = await tenantsRepository.findBySlug(PLATFORM_TENANT_SLUG, connection);
    if (!tenant) {
      tenant = await createTenantWithConnection(connection, { name: PLATFORM_TENANT_NAME, slug: PLATFORM_TENANT_SLUG });
      console.log(`[bootstrap-platform-admin] Created the internal platform tenant "${PLATFORM_TENANT_SLUG}".`);
    }

    const platformRole = await rolesRepository.findSystemRoleByName('Platform Administrator', connection);
    if (!platformRole) {
      // Should be unreachable — seedRbacCatalog() just ran — but fail
      // loudly rather than silently proceeding without the role to assign.
      throw new Error('Platform Administrator role still missing after seeding — aborting.');
    }

    const existing = await usersRepository.findByEmail(tenant.id, email, connection);
    if (existing) {
      const roleIds = new Set(await userRolesRepository.listRoleIdsForUser(existing.id, connection));
      if (roleIds.has(platformRole.id)) {
        return { outcome: 'already_exists', userId: existing.id, tenantSlug: tenant.slug };
      }
      await userRolesRepository.assign(existing.id, platformRole.id, connection);
      return { outcome: 'role_granted_to_existing', userId: existing.id, tenantSlug: tenant.slug };
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await usersRepository.create(
      tenant.id,
      { email, passwordHash, fullName, status: 'active' },
      connection
    );
    await userRolesRepository.assign(user.id, platformRole.id, connection);
    return { outcome: 'created', userId: user.id, tenantSlug: tenant.slug };
  });

  if (result.outcome === 'already_exists') {
    console.log(`[bootstrap-platform-admin] ${email} already exists and already holds Platform Administrator — no action taken. Idempotent, as designed.`);
  } else if (result.outcome === 'role_granted_to_existing') {
    console.log(`[bootstrap-platform-admin] ${email} already existed — granted the missing Platform Administrator role.`);
  } else {
    console.log(`[bootstrap-platform-admin] Created platform admin ${email} (user #${result.userId}) with the Platform Administrator role.`);
  }
  console.log(`[bootstrap-platform-admin] They can now log in at /login using tenant "${result.tenantSlug}" and this email/password, and will land on /platform.`);
  console.log('[bootstrap-platform-admin] Password was never logged or stored anywhere but its bcrypt hash.');

  await pool.end();
} catch (error) {
  await pool.end().catch(() => {});
  fail(`Database operation failed — no account was created or confirmed. ${error.code ?? error.message}`);
}

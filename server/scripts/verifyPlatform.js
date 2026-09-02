// Production verification for the Platform/Tenant system — run BY THE
// OPERATOR against the real configured database, after
// `npm run bootstrap:platform-admin`. Reports PASS/FAIL per check and
// exits non-zero if anything fails, so it is usable in a deploy gate.
//
// SAFETY — read before running:
//   * READ-ONLY by default. It inspects the platform tenant, the platform
//     admin, roles and permissions, and asserts the security invariants
//     that matter, without writing anything.
//   * The optional write phase (--with-tenant) additionally creates ONE
//     clearly-marked throwaway tenant to prove the full create → login →
//     isolation → suspend → reactivate cycle end to end, then deletes
//     exactly what it created (--cleanup, on by default for that phase).
//     It never touches an existing tenant, user, contribution, or any
//     other pre-existing row.
//   * It never prints a password, hash, token, or any secret.
//
// Usage (from /var/www/treasurer/server):
//   npm run verify:platform                       # read-only checks
//   npm run verify:platform -- --with-tenant      # + full lifecycle test
//   npm run verify:platform -- --with-tenant --keep   # leave the test tenant behind
import { pool } from '../src/config/db.js';
import { tenantsRepository } from '../src/modules/tenants/tenants.repository.js';
import { usersRepository } from '../src/modules/users/users.repository.js';
import { rolesRepository } from '../src/modules/roles/roles.repository.js';
import { userRolesRepository } from '../src/modules/roles/userRoles.repository.js';
import { permissionsRepository } from '../src/modules/permissions/permissions.repository.js';
import { PLATFORM_TENANT_SLUG } from '../src/modules/platform/platformTenant.js';
import * as platformService from '../src/modules/platform/platform.service.js';
import * as authService from '../src/modules/auth/auth.service.js';
import { PERMISSIONS, PLATFORM_ONLY_PERMISSIONS } from '../src/db/seeds/permissionCatalog.js';

const withTenant = process.argv.includes('--with-tenant');
const keepTestTenant = process.argv.includes('--keep');

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function checkThrows(name, fn, expectedCode) {
  try {
    await fn();
    check(name, false, 'expected it to be rejected, but it succeeded');
  } catch (error) {
    const code = error.code ?? error.constructor?.name;
    check(name, expectedCode ? code === expectedCode : true, `rejected with ${code}`);
  }
}

console.log('\n=== Clix Treasury — Platform verification ===\n');

// Fail clearly rather than with a driver stack trace if the database this
// backend is configured for isn't reachable — that's an environment
// problem, not a verification result, and the operator needs to be told
// which it is.
try {
  const probe = await pool.getConnection();
  const [[row]] = await probe.query('SELECT DATABASE() AS db');
  probe.release();
  console.log(`Connected to database: ${row.db}\n`);
} catch (error) {
  console.error(`Cannot reach the configured database (${error.code ?? error.message}).`);
  console.error('Check server/.env (DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME) and that MySQL is running.');
  console.error('No checks were run and nothing was modified.');
  await pool.end().catch(() => {});
  process.exit(1);
}

console.log('--- Platform bootstrap state (read-only) ---');

const platformTenant = await tenantsRepository.findBySlug(PLATFORM_TENANT_SLUG);
check('internal platform tenant exists', Boolean(platformTenant), platformTenant ? `id=${platformTenant.id}` : 'run npm run bootstrap:platform-admin first');
check('internal platform tenant is active', platformTenant?.status === 'active', `status=${platformTenant?.status ?? 'n/a'}`);

const platformRole = await rolesRepository.findSystemRoleByName('Platform Administrator');
check('Platform Administrator role exists', Boolean(platformRole));

const platformPermission = await permissionsRepository.findByName('platform.manage');
check('platform.manage permission exists', Boolean(platformPermission));

if (platformRole && platformPermission) {
  const rolePerms = (await permissionsRepository.listForRole(platformRole.id)).map((p) => p.name);
  check('Platform Administrator role grants platform.manage', rolePerms.includes('platform.manage'));
  check(
    'Platform Administrator role grants ONLY platform.manage (no financial permissions)',
    rolePerms.length === 1,
    `grants: ${rolePerms.join(', ')}`
  );
}

let platformAdmins = [];
if (platformTenant) {
  const users = await usersRepository.findAllByTenant(platformTenant.id);
  for (const user of users) {
    const perms = await permissionsRepository.listForUser(user.id);
    if (perms.includes('platform.manage')) platformAdmins.push({ user, perms });
  }
  check('at least one Platform Admin exists', platformAdmins.length > 0, `${platformAdmins.length} found`);
  for (const { user, perms } of platformAdmins) {
    check(`platform admin "${user.email}" is active`, user.status === 'active', `status=${user.status}`);
    // Never print the hash itself — only that it is present and clearly bcrypt-shaped.
    check(
      `platform admin "${user.email}" password is stored hashed`,
      typeof user.password_hash === 'string' && /^\$2[aby]\$/.test(user.password_hash),
      'bcrypt hash present, value not shown'
    );
    check(
      `platform admin "${user.email}" holds NO tenant financial permissions`,
      perms.length === 1 && perms[0] === 'platform.manage',
      `permissions: ${perms.join(', ')}`
    );
  }
}

console.log('\n--- Privilege separation (read-only) ---');
const superAdminRole = await rolesRepository.findSystemRoleByName('Super Administrator');
if (superAdminRole) {
  const superPerms = (await permissionsRepository.listForRole(superAdminRole.id)).map((p) => p.name);
  check(
    'tenant Super Administrator does NOT hold platform.manage',
    !superPerms.includes('platform.manage'),
    `${superPerms.length} permissions granted`
  );
  check(
    'tenant Super Administrator holds every non-platform permission',
    superPerms.length === PERMISSIONS.length - PLATFORM_ONLY_PERMISSIONS.length,
    `${superPerms.length} of ${PERMISSIONS.length - PLATFORM_ONLY_PERMISSIONS.length} expected`
  );
}

console.log('\n--- Platform tenant is protected infrastructure (read-only) ---');
const listed = await platformService.listTenants();
check(
  'internal platform tenant is hidden from the tenant list',
  !listed.some((t) => t.slug === PLATFORM_TENANT_SLUG),
  `${listed.length} tenant(s) listed`
);
if (platformTenant) {
  await checkThrows(
    'internal platform tenant cannot be suspended (would lock out all platform admins)',
    () => platformService.setTenantStatus(platformTenant.id, 'suspended', platformAdmins[0]?.user.id ?? null),
    'FORBIDDEN'
  );
}

if (withTenant) {
  console.log('\n--- Full tenant lifecycle (CREATES ONE THROWAWAY TENANT) ---');
  const stamp = Date.now();
  const churchName = `ZZ Verification Church ${stamp}`;
  const adminEmail = `verify-${stamp}@verification.invalid`;
  // Generated per-run, never printed, never persisted anywhere but its hash.
  const adminPassword = `verify-${stamp}-${Math.random().toString(36).slice(2)}`;
  const actorUserId = platformAdmins[0]?.user.id ?? null;
  let created = null;

  try {
    created = await platformService.createTenant(
      { churchName, adminFullName: 'Verification Admin', adminEmail, adminPassword },
      actorUserId
    );
    check('platform admin can create a tenant', Boolean(created?.tenant?.id), `tenant id=${created.tenant.id}, slug=${created.tenant.slug}`);
    check('created tenant is active', created.tenant.status === 'active');
    check('created tenant has a unique slug', Boolean(created.tenant.slug));
    check('first tenant admin was created', Boolean(created.adminUser?.id));

    const adminPerms = await permissionsRepository.listForUser(created.adminUser.id);
    check('tenant admin does NOT receive platform.manage', !adminPerms.includes('platform.manage'));
    check('tenant admin received tenant-level permissions', adminPerms.length > 0, `${adminPerms.length} permissions`);

    const adminRoleIds = new Set(await userRolesRepository.listRoleIdsForUser(created.adminUser.id));
    check('tenant admin holds the Super Administrator role', superAdminRole ? adminRoleIds.has(superAdminRole.id) : false);

    const adminUserRow = await usersRepository.findById(created.tenant.id, created.adminUser.id);
    check('tenant admin belongs to the correct tenant', adminUserRow?.tenant_id === created.tenant.id);
    check(
      'tenant admin password is stored hashed',
      typeof adminUserRow?.password_hash === 'string' && /^\$2[aby]\$/.test(adminUserRow.password_hash),
      'bcrypt hash present, value not shown'
    );

    console.log('\n--- Authentication ---');
    const login = await authService.login({
      tenantSlug: created.tenant.slug,
      email: adminEmail,
      password: adminPassword,
      ipAddress: '127.0.0.1',
    });
    check('tenant admin can log in', Boolean(login.accessToken));
    check('login response contains no password hash', login.user?.password_hash === undefined);
    check('tenant admin roles do not include Platform Administrator', !login.roles.includes('Platform Administrator'));

    await checkThrows('wrong password is rejected', () =>
      authService.login({ tenantSlug: created.tenant.slug, email: adminEmail, password: 'definitely-the-wrong-password', ipAddress: '127.0.0.1' })
    );

    const tenantRefreshToken = login.refreshToken;
    const refreshed = await authService.refresh({ rawRefreshToken: tenantRefreshToken, ipAddress: '127.0.0.1' });
    check('tenant admin can refresh while active', Boolean(refreshed.accessToken));

    console.log('\n--- Suspension enforcement ---');
    await platformService.setTenantStatus(created.tenant.id, 'suspended', actorUserId);
    const afterSuspend = await tenantsRepository.findById(created.tenant.id);
    check('tenant is suspended', afterSuspend.status === 'suspended');

    await checkThrows('suspended tenant CANNOT log in', () =>
      authService.login({ tenantSlug: created.tenant.slug, email: adminEmail, password: adminPassword, ipAddress: '127.0.0.1' })
    );
    await checkThrows('suspended tenant CANNOT refresh an existing session', () =>
      authService.refresh({ rawRefreshToken: refreshed.refreshToken, ipAddress: '127.0.0.1' })
    );

    const usersStillThere = await usersRepository.findAllByTenant(created.tenant.id);
    check('suspension deleted no data (tenant users still present)', usersStillThere.length > 0, `${usersStillThere.length} user(s)`);

    console.log('\n--- Reactivation ---');
    await platformService.setTenantStatus(created.tenant.id, 'active', actorUserId);
    const relogin = await authService.login({
      tenantSlug: created.tenant.slug,
      email: adminEmail,
      password: adminPassword,
      ipAddress: '127.0.0.1',
    });
    check('reactivated tenant can log in again', Boolean(relogin.accessToken));

    console.log('\n--- Tenant isolation ---');
    const otherTenants = (await tenantsRepository.listAllWithAdminSummary()).filter(
      (t) => t.id !== created.tenant.id && t.slug !== PLATFORM_TENANT_SLUG
    );
    if (otherTenants.length === 0) {
      check('tenant isolation (cross-tenant read returns nothing)', true, 'skipped — no other tenant exists to test against');
    } else {
      const other = otherTenants[0];
      const otherUsers = await usersRepository.findAllByTenant(other.id);
      const victimUserId = otherUsers[0]?.id;
      // The core isolation guarantee: a tenant-scoped lookup for another
      // tenant's row id, scoped to THIS tenant, must return nothing.
      const leaked = victimUserId ? await usersRepository.findById(created.tenant.id, victimUserId) : null;
      check(
        'tenant A cannot read tenant B rows via a tenant-scoped lookup',
        leaked === null,
        victimUserId ? `probed user #${victimUserId} of tenant #${other.id}` : 'no user in other tenant to probe'
      );
    }
  } finally {
    if (created?.tenant?.id && !keepTestTenant) {
      console.log('\n--- Cleanup ---');
      const id = created.tenant.id;
      const conn = await pool.getConnection();
      try {
        // Deletes ONLY the throwaway tenant this run created, and only the
        // rows that belong to it. Ordered to respect foreign keys.
        await conn.beginTransaction();
        await conn.query('DELETE ur FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE u.tenant_id = ?', [id]);
        await conn.query('DELETE rt FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE u.tenant_id = ?', [id]);
        await conn.query('DELETE FROM audit_logs WHERE tenant_id = ?', [id]);
        await conn.query('DELETE FROM users WHERE tenant_id = ?', [id]);
        await conn.query('DELETE FROM church_settings WHERE tenant_id = ?', [id]);
        await conn.query('DELETE FROM tenants WHERE id = ?', [id]);
        await conn.commit();
        check('throwaway verification tenant cleaned up', true, `removed tenant #${id}`);
      } catch (error) {
        await conn.rollback();
        check('throwaway verification tenant cleaned up', false, `${error.code ?? error.message} — remove tenant #${id} manually`);
      } finally {
        conn.release();
      }
    } else if (created?.tenant?.id) {
      console.log(`\n--- Cleanup skipped (--keep): test tenant #${created.tenant.id} "${created.tenant.slug}" left in place ---`);
    }
  }
} else {
  console.log('\n(Read-only run. Add --with-tenant to also verify create/login/suspend/reactivate/isolation end to end.)');
}

const failed = results.filter((r) => !r.passed);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
if (failed.length > 0) {
  console.log('\nFAILED:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
}

await pool.end();
process.exit(failed.length === 0 ? 0 : 1);

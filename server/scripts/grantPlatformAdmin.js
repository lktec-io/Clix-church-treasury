// One-off manual bootstrap: grants the "Platform Administrator" role
// (platform.manage permission) to an existing tenant user. Not an API
// endpoint — there deliberately is no "promote to platform admin" button
// anywhere in the product; the very first platform admin has no other way
// to exist (every /platform action requires platform.manage already), so
// this is the one intentional manual escape hatch, run by hand on the
// server by someone with direct database access.
//
// The user must already exist (register/log in normally first, or be
// created by another platform admin as a tenant's own admin) — this
// script only ever ADDS the platform admin role on top of whatever
// tenant-level roles that account already has; it never creates a user
// or touches their password.
//
// Usage (from server/, after `npm run seed` has run at least once):
//   node scripts/grantPlatformAdmin.js <tenantSlug> <userEmail>
import { pool } from '../src/config/db.js';
import { tenantsRepository } from '../src/modules/tenants/tenants.repository.js';
import { usersRepository } from '../src/modules/users/users.repository.js';
import { rolesRepository } from '../src/modules/roles/roles.repository.js';
import { userRolesRepository } from '../src/modules/roles/userRoles.repository.js';

const [tenantSlug, email] = process.argv.slice(2);
if (!tenantSlug || !email) {
  console.error('Usage: node scripts/grantPlatformAdmin.js <tenantSlug> <userEmail>');
  process.exit(1);
}

const tenant = await tenantsRepository.findBySlug(tenantSlug.trim().toLowerCase());
if (!tenant) {
  console.error(`No tenant with slug "${tenantSlug}"`);
  process.exit(1);
}

const user = await usersRepository.findByEmail(tenant.id, email.trim().toLowerCase());
if (!user) {
  console.error(`No user "${email}" in tenant "${tenantSlug}" — the user must already exist`);
  process.exit(1);
}

const platformRole = await rolesRepository.findSystemRoleByName('Platform Administrator');
if (!platformRole) {
  console.error('The "Platform Administrator" system role is not seeded yet — run `npm run seed` first.');
  process.exit(1);
}

await userRolesRepository.assign(user.id, platformRole.id);
console.log(`Granted platform.manage to ${user.email} (user #${user.id}, tenant "${tenant.slug}").`);
console.log('They can now log in at the normal /login page and will land on /platform.');
await pool.end();

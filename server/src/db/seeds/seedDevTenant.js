import bcrypt from 'bcryptjs';
import { createTenant } from '../../modules/tenants/tenants.service.js';
import { tenantsRepository } from '../../modules/tenants/tenants.repository.js';
import { usersRepository } from '../../modules/users/users.repository.js';
import { rolesRepository } from '../../modules/roles/roles.repository.js';
import { pool } from '../../config/db.js';

const DEV_TENANT_SLUG = 'dev-church';
const DEV_ADMIN_EMAIL = 'admin@dev-church.test';
// Local development only — never used outside NODE_ENV=development/test. Rotate
// immediately if this ever ends up reachable outside a local machine.
const DEV_ADMIN_PASSWORD = 'DevPassword123!';

export async function seedDevTenant() {
  let tenant = await tenantsRepository.findBySlug(DEV_TENANT_SLUG);
  if (!tenant) {
    tenant = await createTenant({ name: 'Dev Church', slug: DEV_TENANT_SLUG });
  }

  let admin = await usersRepository.findByEmail(tenant.id, DEV_ADMIN_EMAIL);
  if (!admin) {
    const passwordHash = await bcrypt.hash(DEV_ADMIN_PASSWORD, 10);
    admin = await usersRepository.create(tenant.id, {
      email: DEV_ADMIN_EMAIL,
      passwordHash,
      fullName: 'Dev Admin',
      status: 'active',
    });

    const superAdminRole = await rolesRepository.findSystemRoleByName('Super Administrator');
    if (superAdminRole) {
      await pool.query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [
        admin.id,
        superAdminRole.id,
      ]);
    }
  }

  return { tenant, admin, devPassword: DEV_ADMIN_PASSWORD };
}

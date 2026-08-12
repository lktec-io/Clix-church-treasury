import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase } from '../helpers/resetDb.js';
import { seedRbacCatalog } from '../../src/db/seeds/seedRbacCatalog.js';
import { seedDevTenant } from '../../src/db/seeds/seedDevTenant.js';
import { permissionsRepository } from '../../src/modules/permissions/permissions.repository.js';
import { rolesRepository } from '../../src/modules/roles/roles.repository.js';
import { PERMISSIONS, SYSTEM_ROLES } from '../../src/db/seeds/permissionCatalog.js';

beforeEach(async () => {
  await resetDatabase();
});

describe('RBAC catalog seed', () => {
  it('creates every permission and every system role exactly once', async () => {
    await seedRbacCatalog();
    const permissions = await permissionsRepository.listAll();
    expect(permissions).toHaveLength(PERMISSIONS.length);

    for (const roleName of Object.keys(SYSTEM_ROLES)) {
      const role = await rolesRepository.findSystemRoleByName(roleName);
      expect(role).not.toBeNull();
      expect(role.tenant_id).toBeNull();
    }
  });

  it('is idempotent — running twice does not duplicate rows or error', async () => {
    await seedRbacCatalog();
    await seedRbacCatalog();
    const permissions = await permissionsRepository.listAll();
    expect(permissions).toHaveLength(PERMISSIONS.length);
  });

  it('Super Administrator receives every permission', async () => {
    await seedRbacCatalog();
    const role = await rolesRepository.findSystemRoleByName('Super Administrator');
    const granted = await permissionsRepository.listForRole(role.id);
    expect(granted).toHaveLength(PERMISSIONS.length);
  });

  it('Viewer receives no write permissions', async () => {
    await seedRbacCatalog();
    const role = await rolesRepository.findSystemRoleByName('Viewer');
    const granted = await permissionsRepository.listForRole(role.id);
    const grantedNames = granted.map((p) => p.name);
    expect(grantedNames.some((name) => name.endsWith('.create'))).toBe(false);
    expect(grantedNames.some((name) => name.endsWith('.manage'))).toBe(false);
    expect(grantedNames.some((name) => name.endsWith('.approve'))).toBe(false);
  });
});

describe('dev tenant seed', () => {
  it('creates a dev tenant with an active Super Administrator user', async () => {
    await seedRbacCatalog();
    const { tenant, admin } = await seedDevTenant();
    expect(tenant.slug).toBe('dev-church');
    expect(admin.status).toBe('active');

    const permissions = await permissionsRepository.listForUser(admin.id);
    expect(permissions).toContain('settings.manage');
  });

  it('is idempotent — running twice reuses the same tenant and user', async () => {
    await seedRbacCatalog();
    const first = await seedDevTenant();
    const second = await seedDevTenant();
    expect(second.tenant.id).toBe(first.tenant.id);
    expect(second.admin.id).toBe(first.admin.id);
  });
});

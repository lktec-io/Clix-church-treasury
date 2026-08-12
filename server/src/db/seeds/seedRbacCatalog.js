import { permissionsRepository } from '../../modules/permissions/permissions.repository.js';
import { rolesRepository } from '../../modules/roles/roles.repository.js';
import { PERMISSIONS, SYSTEM_ROLES } from './permissionCatalog.js';

const ROLE_DESCRIPTIONS = {
  'Super Administrator': 'Full access to every module and every tenant setting.',
  Treasurer: 'Mhazini — full financial recording and management authority for the church.',
  'Assistant Treasurer': 'Can record income/expenses but cannot manage accounts, funds, or budgets.',
  Approver: 'Reviews and approves/rejects pending expenses; cannot create them (segregation of duties).',
  Auditor: 'Read-only access plus the audit log; cannot create or modify financial records.',
  Viewer: 'Read-only access to financial data.',
};

export async function seedRbacCatalog() {
  const permissionIdByName = new Map();

  for (const [name, description] of PERMISSIONS) {
    const existing = await permissionsRepository.findByName(name);
    const permission = existing ?? (await permissionsRepository.create({ name, description }));
    permissionIdByName.set(name, permission.id);
  }

  for (const [roleName, grant] of Object.entries(SYSTEM_ROLES)) {
    let role = await rolesRepository.findSystemRoleByName(roleName);
    if (!role) {
      role = await rolesRepository.createSystemRole({
        name: roleName,
        description: ROLE_DESCRIPTIONS[roleName],
      });
    }

    const permissionNames = grant === 'ALL' ? PERMISSIONS.map(([name]) => name) : grant;
    for (const permissionName of permissionNames) {
      await permissionsRepository.grantToRole(role.id, permissionIdByName.get(permissionName));
    }
  }

  return {
    permissionCount: permissionIdByName.size,
    roleCount: Object.keys(SYSTEM_ROLES).length,
  };
}

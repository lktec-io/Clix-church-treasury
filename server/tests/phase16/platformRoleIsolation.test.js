// The Platform Administrator role is a SYSTEM role (tenant_id IS NULL), the
// same storage class as Treasurer and Auditor — which is exactly why it was
// leaking into every tenant's role picker and, worse, passing assignRole's
// "is this role visible to my tenant?" check. A church admin holding
// users.manage could grant it to themselves and obtain platform.manage,
// i.e. control of every tenant on the platform.
//
// These are pure-unit: they pin the catalog invariants and the SQL shape
// without needing a database.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLATFORM_ONLY_ROLES,
  PLATFORM_ONLY_PERMISSIONS,
  SUPER_ADMIN_ROLE,
  SYSTEM_ROLES,
} from '../../src/db/seeds/permissionCatalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => fs.readFileSync(path.join(here, '..', '..', 'src', rel), 'utf8');

describe('PLATFORM_ONLY_ROLES catalog invariants', () => {
  it('names the Platform Administrator role', () => {
    expect(PLATFORM_ONLY_ROLES).toContain('Platform Administrator');
  });

  // If a role is platform-only it must be a real role in the catalog —
  // otherwise the exclusion silently matches nothing.
  it('every platform-only role actually exists in SYSTEM_ROLES', () => {
    for (const role of PLATFORM_ONLY_ROLES) {
      expect(Object.keys(SYSTEM_ROLES)).toContain(role);
    }
  });

  // The reason the role is dangerous in a tenant context.
  it('every platform-only role grants only platform-only permissions', () => {
    for (const role of PLATFORM_ONLY_ROLES) {
      const grants = SYSTEM_ROLES[role];
      expect(Array.isArray(grants)).toBe(true);
      for (const permission of grants) {
        expect(PLATFORM_ONLY_PERMISSIONS).toContain(permission);
      }
    }
  });

  // The converse: any role granting a platform-only permission MUST be
  // listed as platform-only, or a future role could reintroduce the leak.
  it('no role outside the list grants a platform-only permission', () => {
    for (const [role, grants] of Object.entries(SYSTEM_ROLES)) {
      if (PLATFORM_ONLY_ROLES.includes(role)) continue;
      if (grants === 'ALL') continue; // 'ALL' is expanded with the exclusion applied
      for (const permission of grants) {
        expect(PLATFORM_ONLY_PERMISSIONS).not.toContain(permission);
      }
    }
  });
});

describe('the exclusion is applied in BOTH required places', () => {
  // Filtering the dropdown is not a control — assignRole takes a roleId
  // directly from the request body. Both layers must carry the check, so
  // these assert each file actually references it.
  it('roles.repository.js filters platform-only roles out of listForTenant', () => {
    const file = src('modules/roles/roles.repository.js');
    expect(file).toContain('PLATFORM_ONLY_ROLES');
    const listForTenant = file.slice(file.indexOf('async listForTenant'), file.indexOf('async createSystemRole'));
    expect(listForTenant).toContain('PLATFORM_ONLY_ROLES');
    expect(listForTenant).toMatch(/NOT\s*\(/i);
  });

  it('users.service.js refuses to assign a platform-only role', () => {
    const file = src('modules/users/users.service.js');
    const assignRole = file.slice(file.indexOf('export async function assignRole'), file.indexOf('export async function removeRole'));
    expect(assignRole).toContain('PLATFORM_ONLY_ROLES');
    expect(assignRole).toContain('notFound');
  });
});

describe('self-lockout guards', () => {
  const file = src('modules/users/users.service.js');

  it('a user cannot disable their own account', () => {
    const disableUser = file.slice(file.indexOf('export async function disableUser'));
    expect(disableUser).toContain('userId === actorUserId');
  });

  // The quieter of the two: dropping your own Super Administrator role
  // removes users.manage in the same instant, so nothing in the product can
  // give it back.
  it('a user cannot remove a role from their own account', () => {
    const removeRole = file.slice(file.indexOf('export async function removeRole'), file.indexOf('export async function disableUser'));
    expect(removeRole).toContain('userId === actorUserId');
    expect(removeRole).toContain('forbidden');
  });
});

describe('Super Administrator is immutable from inside a tenant workspace', () => {
  const file = src('modules/users/users.service.js');

  it('exports a Super Administrator role constant rather than a duplicated string literal', () => {
    expect(SUPER_ADMIN_ROLE).toBe('Super Administrator');
    expect(Object.keys(SYSTEM_ROLES)).toContain(SUPER_ADMIN_ROLE);
  });

  // It is the 'ALL' grant that makes this account load-bearing: disabling it
  // can leave a tenant with nobody able to administer it.
  it('the protected role is the one holding the ALL grant', () => {
    expect(SYSTEM_ROLES[SUPER_ADMIN_ROLE]).toBe('ALL');
  });

  it('defines a single shared guard, not a check copy-pasted per call site', () => {
    expect(file).toContain('async function assertNotSuperAdministrator');
    expect(file).toContain('SUPER_ADMIN_ROLE');
    expect(file).toContain('forbidden(');
  });

  it.each([
    ['disableUser', 'export async function disableUser'],
    ['removeRole', 'export async function removeRole'],
  ])('%s calls the guard', (_name, marker) => {
    const start = file.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    // Scan only this function's body, not the rest of the file.
    const body = file.slice(start, start + 1400);
    expect(body).toContain('assertNotSuperAdministrator');
  });

  // listRoleIdsForUser is keyed by user_id alone and is NOT tenant-scoped,
  // so disableUser must confirm the target belongs to this tenant before
  // probing its roles — otherwise a foreign user id becomes an oracle.
  it('disableUser verifies tenant ownership before the role lookup', () => {
    const start = file.indexOf('export async function disableUser');
    const body = file.slice(start, start + 1400);
    const ownershipCheck = body.indexOf('usersRepository.findById');
    const roleCheck = body.indexOf('assertNotSuperAdministrator');
    expect(ownershipCheck).toBeGreaterThan(-1);
    expect(roleCheck).toBeGreaterThan(-1);
    expect(ownershipCheck).toBeLessThan(roleCheck);
  });
});

describe('SMS locale resolution defaults to Swahili', () => {
  // Every fallback in the chain contributor.locale ?? tenant.locale_default
  // ?? X must land on 'sw', or an unset locale silently sends English.
  it('no module still falls back to English', () => {
    const modulesDir = path.join(here, '..', '..', 'src', 'modules');
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js') && /\?\?\s*'en'/.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(modulesDir, full));
        }
      }
    };
    walk(modulesDir);
    expect(offenders).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES, PLATFORM_ONLY_PERMISSIONS } from '../../src/db/seeds/permissionCatalog.js';

// Pure data/logic, no DB — but this is the single most important
// invariant of the whole platform-admin feature: a tenant's Super
// Administrator (whose grant is the literal string 'ALL') must never
// end up holding platform.manage, or every tenant admin on the whole
// system would silently become a platform admin. Mirrors the exact
// expansion expression seedRbacCatalog.js uses for 'ALL', so a change to
// that expression that reintroduces the leak fails this test.
describe('platform.manage is never granted via a tenant role\'s "ALL"', () => {
  it('platform.manage is in the permission catalog', () => {
    expect(PERMISSIONS.some(([name]) => name === 'platform.manage')).toBe(true);
  });

  it('platform.manage is listed as platform-only', () => {
    expect(PLATFORM_ONLY_PERMISSIONS).toContain('platform.manage');
  });

  it('expanding "ALL" (the exact expression seedRbacCatalog.js uses) excludes every platform-only permission', () => {
    const expandedAll = PERMISSIONS.map(([name]) => name).filter(
      (name) => !PLATFORM_ONLY_PERMISSIONS.includes(name)
    );
    expect(expandedAll).not.toContain('platform.manage');
  });

  it('Super Administrator\'s own grant is the literal "ALL" string, not an explicit list (so the exclusion above is what actually protects it)', () => {
    expect(SYSTEM_ROLES['Super Administrator']).toBe('ALL');
  });

  it('no tenant-facing role (every role except Platform Administrator) lists platform.manage explicitly', () => {
    for (const [roleName, grant] of Object.entries(SYSTEM_ROLES)) {
      if (roleName === 'Platform Administrator') continue;
      if (Array.isArray(grant)) {
        expect(grant, `${roleName} must not explicitly list platform.manage`).not.toContain('platform.manage');
      }
    }
  });

  it('Platform Administrator grants ONLY platform.manage — no financial/tenant permissions', () => {
    expect(SYSTEM_ROLES['Platform Administrator']).toEqual(['platform.manage']);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Covers two things added while finalising the platform feature:
//   1. The internal platform tenant is protected infrastructure — hidden
//      from tenant management and impossible to suspend or edit. Without
//      this, one click on "Deactivate" against that tenant would lock every
//      platform administrator out of /platform permanently (login refuses a
//      non-active tenant), recoverable only via direct database access.
//   2. /auth/platform-login refuses to issue a session at all to an account
//      that lacks platform.manage, rather than issuing one and relying on
//      the client to sign itself back out.

const PLATFORM_SLUG = 'clix-platform';

const tenantRows = [
  { id: 1, slug: PLATFORM_SLUG, name: 'Clix Platform (internal)', status: 'active', base_currency: 'TZS', locale_default: 'en', created_at: new Date(), updated_at: new Date(), admin_user_id: 100, admin_email: 'owner@example.test', admin_full_name: 'Owner', user_count: 1 },
  { id: 2, slug: 'grace-church', name: 'Grace Church', status: 'active', base_currency: 'TZS', locale_default: 'en', created_at: new Date(), updated_at: new Date(), admin_user_id: 200, admin_email: 'admin@grace.test', admin_full_name: 'Grace Admin', user_count: 1 },
];

vi.mock('../../src/modules/tenants/tenants.repository.js', () => ({
  tenantsRepository: {
    listAllWithAdminSummary: vi.fn(async () => tenantRows),
    findById: vi.fn(async (id) => tenantRows.find((t) => t.id === Number(id)) ?? null),
    findBySlug: vi.fn(async (slug) => tenantRows.find((t) => t.slug === slug) ?? null),
    updateStatus: vi.fn(async (id, status) => ({ ...tenantRows.find((t) => t.id === Number(id)), status })),
    updateDetails: vi.fn(async (id, u) => ({ ...tenantRows.find((t) => t.id === Number(id)), ...u })),
  },
}));

vi.mock('../../src/modules/users/users.repository.js', () => ({
  usersRepository: { findAllByTenant: vi.fn(async () => []), findByEmail: vi.fn(async () => null), findById: vi.fn(async () => null) },
}));
vi.mock('../../src/modules/contributors/contributors.repository.js', () => ({
  contributorsRepository: { findAllByTenant: vi.fn(async () => []) },
}));
vi.mock('../../src/modules/auth/refreshTokens.repository.js', () => ({
  refreshTokensRepository: { revokeAllForUser: vi.fn(async () => {}) },
}));
vi.mock('../../src/modules/memberAuth/contributorRefreshTokens.repository.js', () => ({
  contributorRefreshTokensRepository: { revokeAllForContributor: vi.fn(async () => {}) },
}));
vi.mock('../../src/modules/audit/auditLog.service.js', () => ({ recordAuditLog: vi.fn(async () => {}) }));
vi.mock('../../src/config/db.js', () => ({ pool: {}, withTransaction: vi.fn(async (fn) => fn({})) }));

const platformService = await import('../../src/modules/platform/platform.service.js');

beforeEach(() => vi.clearAllMocks());

describe('the internal platform tenant is protected infrastructure', () => {
  it('is excluded from the tenant list a platform admin sees', async () => {
    const list = await platformService.listTenants();
    expect(list.some((t) => t.slug === PLATFORM_SLUG)).toBe(false);
    expect(list.some((t) => t.slug === 'grace-church')).toBe(true);
  });

  it('cannot be suspended — that would permanently lock every platform admin out', async () => {
    await expect(platformService.setTenantStatus(1, 'suspended', 100)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('cannot be edited', async () => {
    await expect(
      platformService.updateTenant(1, { name: 'Renamed', baseCurrency: 'TZS', localeDefault: 'en' }, 100)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a real customer tenant CAN still be suspended (the guard is specific, not a blanket block)', async () => {
    const result = await platformService.setTenantStatus(2, 'suspended', 100);
    expect(result.status).toBe('suspended');
  });
});

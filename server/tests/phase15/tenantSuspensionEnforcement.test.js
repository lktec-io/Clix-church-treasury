import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression tests for a real bug found while finishing the platform
// feature: BOTH refresh paths (staff and member) re-issued access tokens
// without ever checking the tenant's own status. Suspending a tenant
// therefore blocked new logins but left every already-signed-in user able
// to mint fresh access tokens indefinitely — i.e. suspension did not
// actually suspend anyone who happened to be online at the time.
//
// Fully mocked at the repository layer so these run without the MySQL
// instance this environment can't reach.

const tenants = new Map([
  [1, { id: 1, status: 'active' }],
  [2, { id: 2, status: 'suspended' }],
]);

vi.mock('../../src/modules/tenants/tenants.repository.js', () => ({
  tenantsRepository: {
    findById: vi.fn(async (id) => tenants.get(Number(id)) ?? null),
  },
}));

const validTokenRecord = { id: 10, user_id: 100, contributor_id: 200, revoked_at: null, expires_at: new Date(Date.now() + 86_400_000) };

vi.mock('../../src/modules/auth/refreshTokens.repository.js', () => ({
  refreshTokensRepository: {
    findByHash: vi.fn(async () => ({ ...validTokenRecord })),
    revoke: vi.fn(async () => {}),
    setReplacement: vi.fn(async () => {}),
    revokeChainFrom: vi.fn(async () => {}),
    create: vi.fn(async () => 11),
  },
}));

vi.mock('../../src/modules/memberAuth/contributorRefreshTokens.repository.js', () => ({
  contributorRefreshTokensRepository: {
    findByHash: vi.fn(async () => ({ ...validTokenRecord })),
    revoke: vi.fn(async () => {}),
    setReplacement: vi.fn(async () => {}),
    revokeChainFrom: vi.fn(async () => {}),
    create: vi.fn(async () => 11),
  },
}));

// user 100 belongs to the ACTIVE tenant 1; user 101 to the SUSPENDED tenant 2.
vi.mock('../../src/modules/users/users.repository.js', () => ({
  usersRepository: {
    findByIdAnyTenant: vi.fn(async (id) =>
      Number(id) === 100
        ? { id: 100, tenant_id: 1, status: 'active' }
        : { id: 101, tenant_id: 2, status: 'active' }
    ),
  },
}));

vi.mock('../../src/modules/contributors/contributors.repository.js', () => ({
  contributorsRepository: {
    findByIdAnyTenant: vi.fn(async (id) =>
      Number(id) === 200
        ? { id: 200, tenant_id: 1, is_active: 1, portal_enabled_at: new Date() }
        : { id: 201, tenant_id: 2, is_active: 1, portal_enabled_at: new Date() }
    ),
  },
}));

vi.mock('../../src/modules/roles/roles.repository.js', () => ({
  rolesRepository: { listForTenant: vi.fn(async () => []) },
}));
vi.mock('../../src/modules/roles/userRoles.repository.js', () => ({
  userRolesRepository: { listRoleIdsForUser: vi.fn(async () => []) },
}));
vi.mock('../../src/modules/audit/auditLog.service.js', () => ({
  recordAuditLog: vi.fn(async () => {}),
}));
vi.mock('../../src/config/db.js', () => ({
  pool: {},
  withTransaction: vi.fn(async (fn) => fn({})),
}));

const authService = await import('../../src/modules/auth/auth.service.js');
const memberAuthService = await import('../../src/modules/memberAuth/memberAuth.service.js');
const { usersRepository } = await import('../../src/modules/users/users.repository.js');
const { contributorsRepository } = await import('../../src/modules/contributors/contributors.repository.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('staff refresh honours tenant suspension', () => {
  it('succeeds for a user whose tenant is active', async () => {
    usersRepository.findByIdAnyTenant.mockResolvedValueOnce({ id: 100, tenant_id: 1, status: 'active' });
    const result = await authService.refresh({ rawRefreshToken: 'anything', ipAddress: '127.0.0.1' });
    expect(result.accessToken).toBeTruthy();
  });

  it('REFUSES to refresh for a user whose tenant is suspended — the bug this test exists for', async () => {
    usersRepository.findByIdAnyTenant.mockResolvedValueOnce({ id: 101, tenant_id: 2, status: 'active' });
    await expect(
      authService.refresh({ rawRefreshToken: 'anything', ipAddress: '127.0.0.1' })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('uses the same generic message for a suspended tenant as for a disabled account (no enumeration)', async () => {
    usersRepository.findByIdAnyTenant.mockResolvedValueOnce({ id: 101, tenant_id: 2, status: 'active' });
    const suspended = await authService
      .refresh({ rawRefreshToken: 'anything', ipAddress: '127.0.0.1' })
      .catch((e) => e.message);
    usersRepository.findByIdAnyTenant.mockResolvedValueOnce({ id: 100, tenant_id: 1, status: 'disabled' });
    const disabled = await authService
      .refresh({ rawRefreshToken: 'anything', ipAddress: '127.0.0.1' })
      .catch((e) => e.message);
    expect(suspended).toBe(disabled);
  });
});

describe('member refresh honours tenant suspension', () => {
  it('succeeds for a contributor whose tenant is active', async () => {
    contributorsRepository.findByIdAnyTenant.mockResolvedValueOnce({
      id: 200, tenant_id: 1, is_active: 1, portal_enabled_at: new Date(),
    });
    const result = await memberAuthService.refresh({ rawRefreshToken: 'anything', ipAddress: '127.0.0.1' });
    expect(result.accessToken).toBeTruthy();
  });

  it('REFUSES to refresh for a contributor whose tenant is suspended', async () => {
    contributorsRepository.findByIdAnyTenant.mockResolvedValueOnce({
      id: 201, tenant_id: 2, is_active: 1, portal_enabled_at: new Date(),
    });
    await expect(
      memberAuthService.refresh({ rawRefreshToken: 'anything', ipAddress: '127.0.0.1' })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

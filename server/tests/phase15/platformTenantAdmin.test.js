import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Same real-HTTP-through-real-Express-app approach as
// platformAuthorization.test.js — proves the tenant-admin
// credential-management endpoints are both (a) platform-admin-only and
// (b) still tenant-scoped underneath (a userId from the wrong tenant must
// be rejected, not silently acted on), with the database layer mocked so
// this runs without the local MySQL dependency every integration test in
// this repo currently can't reach.
vi.mock('../../src/modules/permissions/permissions.repository.js', () => ({
  permissionsRepository: {
    listForUser: vi.fn(async (userId) => (userId === 1 ? ['platform.manage'] : [])),
  },
}));

const usersById = new Map([
  [10, { id: 10, tenant_id: 5, email: 'admin@church-a.test', full_name: 'Church A Admin', status: 'active' }],
  // A user that belongs to a DIFFERENT tenant (7) than the one the request
  // targets (5) — the tenant-isolation case.
  [20, { id: 20, tenant_id: 7, email: 'admin@church-b.test', full_name: 'Church B Admin', status: 'active' }],
]);

vi.mock('../../src/modules/users/users.repository.js', () => ({
  usersRepository: {
    // Mirrors the real TenantScopedRepository contract exactly: only
    // returns a row when BOTH tenantId and id match — this is the exact
    // mechanism that must reject a cross-tenant userId.
    findById: vi.fn(async (tenantId, id) => {
      const user = usersById.get(Number(id));
      return user && user.tenant_id === tenantId ? user : null;
    }),
    findByEmail: vi.fn(async () => null),
    update: vi.fn(async (tenantId, id, updates) => ({ ...usersById.get(Number(id)), ...updates })),
    setPasswordHash: vi.fn(async () => {}),
  },
}));

vi.mock('../../src/modules/auth/refreshTokens.repository.js', () => ({
  refreshTokensRepository: { revokeAllForUser: vi.fn(async () => {}) },
}));

vi.mock('../../src/modules/audit/auditLog.service.js', () => ({
  recordAuditLog: vi.fn(async () => {}),
}));

const { buildTestApp } = await import('../helpers/testApp.js');

const PLATFORM_ADMIN = { userId: 1, tenantId: 1, roles: ['Platform Administrator'] };
const TENANT_ADMIN = { userId: 2, tenantId: 5, roles: ['Super Administrator'] };

describe('PATCH /api/v1/platform/tenants/:id/admin', () => {
  it('a tenant user (even a Super Administrator) gets 403 — this is platform-admin-only', async () => {
    const app = buildTestApp(TENANT_ADMIN);
    const res = await request(app)
      .patch('/api/v1/platform/tenants/5/admin')
      .send({ userId: 10, fullName: 'New Name', email: 'new@church-a.test' });
    expect(res.status).toBe(403);
  });

  it('a platform admin can update the admin of the tenant that user actually belongs to', async () => {
    const app = buildTestApp(PLATFORM_ADMIN);
    const res = await request(app)
      .patch('/api/v1/platform/tenants/5/admin')
      .send({ userId: 10, fullName: 'Updated Name', email: 'updated@church-a.test' });
    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('Updated Name');
    // Never a password/hash in the response.
    expect(res.body.data.password).toBeUndefined();
    expect(res.body.data.passwordHash).toBeUndefined();
    expect(res.body.data.password_hash).toBeUndefined();
  });

  it('a platform admin CANNOT edit a user by passing a userId that belongs to a different tenant than the URL — 404, not a silent cross-tenant write', async () => {
    const app = buildTestApp(PLATFORM_ADMIN);
    // userId 20 belongs to tenant 7, but the URL says tenant 5.
    const res = await request(app)
      .patch('/api/v1/platform/tenants/5/admin')
      .send({ userId: 20, fullName: 'Hijacked Name', email: 'hijacked@evil.test' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/platform/tenants/:id/admin/reset-password', () => {
  it('a tenant user gets 403', async () => {
    const app = buildTestApp(TENANT_ADMIN);
    const res = await request(app)
      .post('/api/v1/platform/tenants/5/admin/reset-password')
      .send({ userId: 10, newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(403);
  });

  it('a platform admin can reset the password of a user in the correct tenant, response never contains the password', async () => {
    const app = buildTestApp(PLATFORM_ADMIN);
    const res = await request(app)
      .post('/api/v1/platform/tenants/5/admin/reset-password')
      .send({ userId: 10, newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('a-brand-new-password');
  });

  it('rejects a password shorter than the app-wide minimum (10 chars)', async () => {
    const app = buildTestApp(PLATFORM_ADMIN);
    const res = await request(app)
      .post('/api/v1/platform/tenants/5/admin/reset-password')
      .send({ userId: 10, newPassword: 'short' });
    expect(res.status).toBe(422);
  });

  it('a cross-tenant userId is rejected here too — 404, not a silent cross-tenant password reset', async () => {
    const app = buildTestApp(PLATFORM_ADMIN);
    const res = await request(app)
      .post('/api/v1/platform/tenants/5/admin/reset-password')
      .send({ userId: 20, newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(404);
  });
});

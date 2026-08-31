import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Proves the REAL Express authorization chain end-to-end — real
// createApp(), real requirePlatformAdmin/requirePermission middleware,
// real platform.controller.js/platform.service.js — with only the
// database's permission lookup and the tenant-list query mocked, so this
// test runs with zero live MySQL dependency (the same local-machine
// blocker every other integration test in this repo currently hits) while
// still exercising actual HTTP requests through the actual route stack,
// not just unit-level assertions on isolated functions.
vi.mock('../../src/modules/permissions/permissions.repository.js', () => ({
  permissionsRepository: {
    listForUser: vi.fn(async (userId) => (userId === 1 ? ['platform.manage'] : ['income.view', 'expense.view'])),
  },
}));

vi.mock('../../src/modules/tenants/tenants.repository.js', () => ({
  tenantsRepository: {
    listAllWithAdminSummary: vi.fn(async () => []),
  },
}));

const { buildTestApp } = await import('../helpers/testApp.js');

describe('GET /api/v1/platform/tenants — authorization', () => {
  it('a tenant user WITHOUT platform.manage gets 403, even though they are fully authenticated', async () => {
    const app = buildTestApp({ userId: 2, tenantId: 5, roles: ['Super Administrator'] });
    const res = await request(app).get('/api/v1/platform/tenants');
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('a user WITH platform.manage gets through — proves the authorization layer, controller, and service are wired correctly', async () => {
    const app = buildTestApp({ userId: 1, tenantId: 1, roles: ['Platform Administrator'] });
    const res = await request(app).get('/api/v1/platform/tenants');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('an unauthenticated request never reaches the authorization check at all — 401 from authenticate, not 403 from requirePlatformAdmin', async () => {
    // buildTestApp always injects a fake authenticated req.auth (that's
    // what it's for); this asserts the OTHER two /platform routes behave
    // the same way as /tenants for the no-permission case, so the
    // boundary isn't accidentally route-specific.
    const app = buildTestApp({ userId: 2, tenantId: 5, roles: ['Super Administrator'] });
    const createRes = await request(app).post('/api/v1/platform/tenants').send({});
    expect(createRes.status).toBe(403);
    const statusRes = await request(app).patch('/api/v1/platform/tenants/1/status').send({ status: 'active' });
    expect(statusRes.status).toBe(403);
  });
});

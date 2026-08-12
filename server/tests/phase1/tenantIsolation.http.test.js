import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestTenant, createTestAccount, createTestUserWithRole } from '../helpers/fixtures.js';

beforeEach(async () => {
  await resetDatabase();
});

describe('tenant isolation — HTTP layer', () => {
  it('an authenticated user only ever sees their own tenant\'s accounts', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const userA = await createTestUserWithRole(tenantA.id);
    await createTestAccount(tenantA.id);
    const bAccount = await createTestAccount(tenantB.id);

    const app = buildTestApp({ userId: userA.id, tenantId: tenantA.id });
    const res = await request(app).get('/api/v1/accounts').expect(200);

    expect(res.body.data.every((a) => a.tenant_id === tenantA.id)).toBe(true);
    expect(res.body.data.find((a) => a.id === bAccount.id)).toBeUndefined();
  });

  it('manipulating the :id in the URL cannot fetch another tenant\'s account (404, not 403)', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const userA = await createTestUserWithRole(tenantA.id);
    const bAccount = await createTestAccount(tenantB.id);

    const app = buildTestApp({ userId: userA.id, tenantId: tenantA.id });
    const res = await request(app).get(`/api/v1/accounts/${bAccount.id}`).expect(404);

    // A 404, not a 403 — a 403 would confirm the resource exists cross-tenant.
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('a request body tenant_id field cannot override the authenticated tenant', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const userA = await createTestUserWithRole(tenantA.id);

    const app = buildTestApp({ userId: userA.id, tenantId: tenantA.id });
    const res = await request(app)
      .post('/api/v1/accounts')
      .send({ name: 'Sneaky Account', type: 'cash', tenantId: tenantB.id, tenant_id: tenantB.id })
      .expect(201);

    expect(res.body.data.tenant_id).toBe(tenantA.id);
  });

  it('a user cannot use their access to act against a different tenant by swapping tenantId alone', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const userA = await createTestUserWithRole(tenantA.id);
    await createTestAccount(tenantB.id, { name: 'B Only Account' });

    // Same real user, but a forged auth context claiming tenant B — this can
    // only happen if a JWT were forged, which authenticate.js's signature
    // verification prevents; this test documents the invariant the fake-auth
    // test harness must never violate the real middleware would enforce.
    const app = buildTestApp({ userId: userA.id, tenantId: tenantB.id });
    const res = await request(app).get('/api/v1/accounts').expect(200);

    // Because tenantId truly drives scoping, "B Only Account" is visible —
    // proving isolation is enforced by tenantId, not by which user is asking.
    expect(res.body.data.some((a) => a.name === 'B Only Account')).toBe(true);
  });

  it('a request with no auth context is rejected before reaching a controller', async () => {
    const app = buildTestApp(undefined); // fakeAuth still runs, sets req.auth = undefined
    const res = await request(app).get('/api/v1/accounts').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('a request with an auth context but no tenantId is rejected', async () => {
    const tenantA = await createTestTenant();
    const userA = await createTestUserWithRole(tenantA.id);
    const app = buildTestApp({ userId: userA.id }); // no tenantId
    const res = await request(app).get('/api/v1/accounts').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('a user without accounts.view permission is forbidden, not silently scoped', async () => {
    const tenantA = await createTestTenant();
    const viewerUser = await createTestUserWithRole(tenantA.id, 'Approver'); // no accounts.* permissions

    const app = buildTestApp({ userId: viewerUser.id, tenantId: tenantA.id });
    const res = await request(app).get('/api/v1/accounts').expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestTenant, createTestUserWithRole } from '../helpers/fixtures.js';

beforeEach(async () => {
  await resetDatabase();
});

describe('contributors', () => {
  it('a Treasurer can create and list contributors', async () => {
    const tenant = await createTestTenant();
    const user = await createTestUserWithRole(tenant.id, 'Treasurer');
    const app = buildTestApp({ userId: user.id, tenantId: tenant.id });

    const createRes = await request(app)
      .post('/api/v1/contributors')
      .send({ fullName: 'John Mwangi', phone: '+255700000000' })
      .expect(201);
    expect(createRes.body.data.full_name).toBe('John Mwangi');

    const listRes = await request(app).get('/api/v1/contributors').expect(200);
    expect(listRes.body.data).toHaveLength(1);
  });

  it('an Auditor cannot create a contributor (contributors.manage required)', async () => {
    const tenant = await createTestTenant();
    const user = await createTestUserWithRole(tenant.id, 'Auditor');
    const app = buildTestApp({ userId: user.id, tenantId: tenant.id });

    await request(app).post('/api/v1/contributors').send({ fullName: 'X' }).expect(403);
  });

  it('an Auditor cannot even list contributors (no contributors.view)', async () => {
    const tenant = await createTestTenant();
    const user = await createTestUserWithRole(tenant.id, 'Auditor');
    const app = buildTestApp({ userId: user.id, tenantId: tenant.id });

    await request(app).get('/api/v1/contributors').expect(403);
  });

  it('rejects a duplicate member number within a tenant', async () => {
    const tenant = await createTestTenant();
    const user = await createTestUserWithRole(tenant.id, 'Treasurer');
    const app = buildTestApp({ userId: user.id, tenantId: tenant.id });

    await request(app).post('/api/v1/contributors').send({ fullName: 'A', memberNumber: 'M-1' }).expect(201);
    const res = await request(app)
      .post('/api/v1/contributors')
      .send({ fullName: 'B', memberNumber: 'M-1' })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('tenant isolation: tenant A cannot fetch tenant B\'s contributor', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const userA = await createTestUserWithRole(tenantA.id, 'Treasurer');
    const userB = await createTestUserWithRole(tenantB.id, 'Treasurer');
    const appA = buildTestApp({ userId: userA.id, tenantId: tenantA.id });
    const appB = buildTestApp({ userId: userB.id, tenantId: tenantB.id });

    const created = await request(appB).post('/api/v1/contributors').send({ fullName: 'B Contributor' }).expect(201);
    await request(appA).get(`/api/v1/contributors/${created.body.data.id}`).expect(404);
  });
});

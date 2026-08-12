import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestTenant, createTestUserWithRole } from '../helpers/fixtures.js';

beforeEach(async () => {
  await resetDatabase();
});

describe('categories', () => {
  it('a Treasurer can create income and expense categories', async () => {
    const tenant = await createTestTenant();
    const user = await createTestUserWithRole(tenant.id, 'Treasurer');
    const app = buildTestApp({ userId: user.id, tenantId: tenant.id });

    await request(app).post('/api/v1/categories').send({ type: 'income', name: 'Tithe' }).expect(201);
    await request(app).post('/api/v1/categories').send({ type: 'expense', name: 'Electricity' }).expect(201);

    const res = await request(app).get('/api/v1/categories?type=income').expect(200);
    expect(res.body.data.map((c) => c.name)).toEqual(['Tithe']);
  });

  it('an Approver (no categories.manage) can still view categories but not create one', async () => {
    const tenant = await createTestTenant();
    const treasurer = await createTestUserWithRole(tenant.id, 'Treasurer');
    const treasurerApp = buildTestApp({ userId: treasurer.id, tenantId: tenant.id });
    await request(treasurerApp).post('/api/v1/categories').send({ type: 'expense', name: 'Transport' }).expect(201);

    const approver = await createTestUserWithRole(tenant.id, 'Approver');
    const approverApp = buildTestApp({ userId: approver.id, tenantId: tenant.id });
    await request(approverApp).get('/api/v1/categories').expect(200);
    await request(approverApp).post('/api/v1/categories').send({ type: 'expense', name: 'Rent' }).expect(403);
  });

  it('rejects a duplicate (type, name) within a tenant', async () => {
    const tenant = await createTestTenant();
    const user = await createTestUserWithRole(tenant.id, 'Treasurer');
    const app = buildTestApp({ userId: user.id, tenantId: tenant.id });

    await request(app).post('/api/v1/categories').send({ type: 'income', name: 'Offering' }).expect(201);
    const res = await request(app)
      .post('/api/v1/categories')
      .send({ type: 'income', name: 'Offering' })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

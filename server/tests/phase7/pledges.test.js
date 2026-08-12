import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import {
  createTestTenant,
  createFinancialFixtures,
  createTestUserWithRole,
  createTestContributor,
} from '../helpers/fixtures.js';

beforeEach(async () => {
  await resetDatabase();
});

async function setup(roleName = 'Treasurer') {
  const tenant = await createTestTenant();
  const fixtures = await createFinancialFixtures(tenant.id);
  const contributor = await createTestContributor(tenant.id, { fullName: 'Jane Pledge' });
  const user = await createTestUserWithRole(tenant.id, roleName);
  const app = buildTestApp({ userId: user.id, tenantId: tenant.id });
  return { tenant, ...fixtures, contributor, user, app };
}

function pledgePayload(ctx, overrides = {}) {
  return {
    contributorId: ctx.contributor.id,
    fundId: ctx.fund.id,
    pledgedAmount: '1000000.00',
    pledgeDate: '2026-01-01',
    ...overrides,
  };
}

describe('POST /pledges', () => {
  it('creates a pledge with zero fulfillment initially', async () => {
    const ctx = await setup();
    const res = await request(ctx.app).post('/api/v1/pledges').send(pledgePayload(ctx)).expect(201);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.fulfilled_amount).toBe('0.00');
    expect(res.body.data.remaining_amount).toBe('1000000.00');
  });

  it('rejects an invalid amount', async () => {
    const ctx = await setup();
    await request(ctx.app)
      .post('/api/v1/pledges')
      .send(pledgePayload(ctx, { pledgedAmount: '-5.00' }))
      .expect(422);
  });

  it('a Viewer cannot create a pledge', async () => {
    const ctx = await setup('Viewer');
    await request(ctx.app).post('/api/v1/pledges').send(pledgePayload(ctx)).expect(403);
  });
});

describe('pledge payments via the contribution system', () => {
  it('multiple payments reduce the remaining balance correctly', async () => {
    const ctx = await setup();
    const pledgeRes = await request(ctx.app).post('/api/v1/pledges').send(pledgePayload(ctx)).expect(201);
    const pledgeId = pledgeRes.body.data.id;

    await request(ctx.app)
      .post('/api/v1/contributions')
      .send({
        amount: '300000.00',
        accountId: ctx.account.id,
        fundId: ctx.fund.id,
        categoryId: ctx.incomeCategory.id,
        paymentMethod: 'cash',
        contributionDate: '2026-01-05',
        pledgeId,
      })
      .expect(201);

    await request(ctx.app)
      .post('/api/v1/contributions')
      .send({
        amount: '200000.00',
        accountId: ctx.account.id,
        fundId: ctx.fund.id,
        categoryId: ctx.incomeCategory.id,
        paymentMethod: 'cash',
        contributionDate: '2026-01-10',
        pledgeId,
      })
      .expect(201);

    const pledge = await request(ctx.app).get(`/api/v1/pledges/${pledgeId}`).expect(200);
    expect(pledge.body.data.fulfilled_amount).toBe('500000.00');
    expect(pledge.body.data.remaining_amount).toBe('500000.00');
    expect(pledge.body.data.status).toBe('active');
  });

  it('auto-completes a pledge once fully paid', async () => {
    const ctx = await setup();
    const pledgeRes = await request(ctx.app)
      .post('/api/v1/pledges')
      .send(pledgePayload(ctx, { pledgedAmount: '100.00' }))
      .expect(201);

    await request(ctx.app)
      .post('/api/v1/contributions')
      .send({
        amount: '100.00',
        accountId: ctx.account.id,
        fundId: ctx.fund.id,
        categoryId: ctx.incomeCategory.id,
        paymentMethod: 'cash',
        contributionDate: '2026-01-05',
        pledgeId: pledgeRes.body.data.id,
      })
      .expect(201);

    const pledge = await request(ctx.app).get(`/api/v1/pledges/${pledgeRes.body.data.id}`).expect(200);
    expect(pledge.body.data.status).toBe('completed');
    expect(pledge.body.data.remaining_amount).toBe('0.00');
  });

  it('reverts to active if a completing payment is reversed', async () => {
    const ctx = await setup();
    const pledgeRes = await request(ctx.app)
      .post('/api/v1/pledges')
      .send(pledgePayload(ctx, { pledgedAmount: '100.00' }))
      .expect(201);

    const contribRes = await request(ctx.app)
      .post('/api/v1/contributions')
      .send({
        amount: '100.00',
        accountId: ctx.account.id,
        fundId: ctx.fund.id,
        categoryId: ctx.incomeCategory.id,
        paymentMethod: 'cash',
        contributionDate: '2026-01-05',
        pledgeId: pledgeRes.body.data.id,
      })
      .expect(201);

    await request(ctx.app)
      .post(`/api/v1/contributions/${contribRes.body.data.id}/reverse`)
      .send({ reason: 'Recorded against the wrong pledge' })
      .expect(200);

    const pledge = await request(ctx.app).get(`/api/v1/pledges/${pledgeRes.body.data.id}`).expect(200);
    expect(pledge.body.data.status).toBe('active');
    expect(pledge.body.data.remaining_amount).toBe('100.00');
  });

  it('rejects a payment that would exceed the pledge', async () => {
    const ctx = await setup();
    const pledgeRes = await request(ctx.app)
      .post('/api/v1/pledges')
      .send(pledgePayload(ctx, { pledgedAmount: '100.00' }))
      .expect(201);

    const res = await request(ctx.app)
      .post('/api/v1/contributions')
      .send({
        amount: '150.00',
        accountId: ctx.account.id,
        fundId: ctx.fund.id,
        categoryId: ctx.incomeCategory.id,
        paymentMethod: 'cash',
        contributionDate: '2026-01-05',
        pledgeId: pledgeRes.body.data.id,
      })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a payment against a cancelled pledge', async () => {
    const ctx = await setup();
    const pledgeRes = await request(ctx.app).post('/api/v1/pledges').send(pledgePayload(ctx)).expect(201);
    await request(ctx.app)
      .post(`/api/v1/pledges/${pledgeRes.body.data.id}/status`)
      .send({ status: 'cancelled' })
      .expect(200);

    await request(ctx.app)
      .post('/api/v1/contributions')
      .send({
        amount: '10.00',
        accountId: ctx.account.id,
        fundId: ctx.fund.id,
        categoryId: ctx.incomeCategory.id,
        paymentMethod: 'cash',
        contributionDate: '2026-01-05',
        pledgeId: pledgeRes.body.data.id,
      })
      .expect(409);
  });

  it('does not double-post a ledger transaction for a pledge payment', async () => {
    const ctx = await setup();
    const pledgeRes = await request(ctx.app).post('/api/v1/pledges').send(pledgePayload(ctx)).expect(201);

    const engine = await import('../../src/modules/financial/financialEngine.service.js');
    const before = await engine.getAccountBalance(ctx.tenant.id, ctx.account.id);

    await request(ctx.app)
      .post('/api/v1/contributions')
      .send({
        amount: '50.00',
        accountId: ctx.account.id,
        fundId: ctx.fund.id,
        categoryId: ctx.incomeCategory.id,
        paymentMethod: 'cash',
        contributionDate: '2026-01-05',
        pledgeId: pledgeRes.body.data.id,
      })
      .expect(201);

    const after = await engine.getAccountBalance(ctx.tenant.id, ctx.account.id);
    expect(Number(after) - Number(before)).toBe(50);
  });
});

describe('pledge privacy and tenant isolation', () => {
  it('a role without contributors.view sees pledges without contributor identity', async () => {
    const ctx = await setup('Treasurer');
    await request(ctx.app).post('/api/v1/pledges').send(pledgePayload(ctx)).expect(201);

    const auditor = await createTestUserWithRole(ctx.tenant.id, 'Auditor');
    const auditorApp = buildTestApp({ userId: auditor.id, tenantId: ctx.tenant.id });
    const res = await request(auditorApp).get('/api/v1/pledges').expect(200);
    expect(res.body.data[0].contributor).toBeUndefined();
    expect(res.body.data[0].pledged_amount).toBe('1000000.00');
  });

  it('tenant A cannot access tenant B pledges', async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    const pledgeB = await request(ctxB.app).post('/api/v1/pledges').send(pledgePayload(ctxB)).expect(201);
    await request(ctxA.app).get(`/api/v1/pledges/${pledgeB.body.data.id}`).expect(404);
  });
});

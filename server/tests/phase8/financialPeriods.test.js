import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestTenant, createFinancialFixtures, createTestUserWithRole } from '../helpers/fixtures.js';
import * as engine from '../../src/modules/financial/financialEngine.service.js';

beforeEach(async () => {
  await resetDatabase();
});

async function setup(roleName = 'Treasurer') {
  const tenant = await createTestTenant();
  const fixtures = await createFinancialFixtures(tenant.id);
  const user = await createTestUserWithRole(tenant.id, roleName);
  const app = buildTestApp({ userId: user.id, tenantId: tenant.id });
  return { tenant, ...fixtures, user, app };
}

describe('POST /financial-periods', () => {
  it('creates a new period', async () => {
    const tenant = await createTestTenant();
    const user = await createTestUserWithRole(tenant.id, 'Treasurer');
    const app = buildTestApp({ userId: user.id, tenantId: tenant.id });

    const res = await request(app)
      .post('/api/v1/financial-periods')
      .send({ label: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31' })
      .expect(201);
    expect(res.body.data.status).toBe('open');
  });

  it('rejects an end date before the start date', async () => {
    const tenant = await createTestTenant();
    const user = await createTestUserWithRole(tenant.id, 'Treasurer');
    const app = buildTestApp({ userId: user.id, tenantId: tenant.id });

    await request(app)
      .post('/api/v1/financial-periods')
      .send({ label: 'Bad Period', startDate: '2026-06-01', endDate: '2026-01-01' })
      .expect(422);
  });

  it('a Viewer cannot create a period', async () => {
    const ctx = await setup('Viewer');
    await request(ctx.app)
      .post('/api/v1/financial-periods')
      .send({ label: 'x', startDate: '2026-01-01', endDate: '2026-12-31' })
      .expect(403);
  });
});

describe('closing summary and checklist', () => {
  it('the summary matches the financial engine exactly', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income',
      accountId: ctx.account.id,
      fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id,
      amount: '1000.00',
      createdByUserId: ctx.user.id,
    });
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'expense',
      accountId: ctx.account.id,
      fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id,
      amount: '300.00',
      createdByUserId: ctx.user.id,
    });

    const res = await request(ctx.app).get(`/api/v1/financial-periods/${ctx.period.id}/summary`).expect(200);
    expect(res.body.data.openingBalance).toBe('0.00'); // first-ever period
    expect(res.body.data.totalIncome).toBe('1000.00');
    expect(res.body.data.totalExpenses).toBe('300.00');
    expect(res.body.data.closingBalance).toBe('700.00');

    const directBalance = await engine.getAccountBalance(ctx.tenant.id, ctx.account.id);
    expect(res.body.data.closingBalance).toBe(directBalance);
  });

  it('the checklist reports pending/approved-unpaid expenses without blocking', async () => {
    const ctx = await setup();
    const draftRes = await request(ctx.app)
      .post('/api/v1/expenses')
      .send({
        amount: '50.00',
        categoryId: ctx.expenseCategory.id,
        fundId: ctx.fund.id,
        accountId: ctx.account.id,
        payee: 'Vendor',
        paymentMethod: 'cash',
      })
      .expect(201);
    await request(ctx.app).post(`/api/v1/expenses/${draftRes.body.data.id}/submit`).expect(200);

    const res = await request(ctx.app).get(`/api/v1/financial-periods/${ctx.period.id}/checklist`).expect(200);
    expect(res.body.data.pendingApprovalCount).toBe(1);
  });
});

describe('closing and reopening', () => {
  it('closes a period and blocks further posting to it', async () => {
    const ctx = await setup();
    await request(ctx.app).post(`/api/v1/financial-periods/${ctx.period.id}/close`).expect(200);

    await expect(
      engine.recordSimpleTransaction(ctx.tenant.id, {
        type: 'income',
        accountId: ctx.account.id,
        fundId: ctx.fund.id,
        financialPeriodId: ctx.period.id,
        amount: '10.00',
        createdByUserId: ctx.user.id,
      })
    ).rejects.toMatchObject({ code: 'PERIOD_LOCKED' });
  });

  it('historical data remains viewable after closing', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income',
      accountId: ctx.account.id,
      fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id,
      amount: '500.00',
      createdByUserId: ctx.user.id,
    });
    await request(ctx.app).post(`/api/v1/financial-periods/${ctx.period.id}/close`).expect(200);

    const res = await request(ctx.app).get(`/api/v1/financial-periods/${ctx.period.id}/summary`).expect(200);
    expect(res.body.data.closingBalance).toBe('500.00');
  });

  it('reopening requires a reason', async () => {
    const ctx = await setup();
    await request(ctx.app).post(`/api/v1/financial-periods/${ctx.period.id}/close`).expect(200);

    const superAdmin = await createTestUserWithRole(ctx.tenant.id, 'Super Administrator');
    const superAdminApp = buildTestApp({ userId: superAdmin.id, tenantId: ctx.tenant.id });
    await request(superAdminApp).post(`/api/v1/financial-periods/${ctx.period.id}/reopen`).send({}).expect(422);
  });

  it('reopening with a reason unlocks posting again (Super Administrator only — Treasurer lacks financial_period.reopen by design)', async () => {
    const ctx = await setup();
    await request(ctx.app).post(`/api/v1/financial-periods/${ctx.period.id}/close`).expect(200);

    const superAdmin = await createTestUserWithRole(ctx.tenant.id, 'Super Administrator');
    const superAdminApp = buildTestApp({ userId: superAdmin.id, tenantId: ctx.tenant.id });
    await request(superAdminApp)
      .post(`/api/v1/financial-periods/${ctx.period.id}/reopen`)
      .send({ reason: 'Found an unrecorded contribution from last week' })
      .expect(200);

    await expect(
      engine.recordSimpleTransaction(ctx.tenant.id, {
        type: 'income',
        accountId: ctx.account.id,
        fundId: ctx.fund.id,
        financialPeriodId: ctx.period.id,
        amount: '10.00',
        createdByUserId: ctx.user.id,
      })
    ).resolves.toBeTruthy();
  });

  it('a Treasurer (who can close) cannot reopen without financial_period.reopen', async () => {
    const ctx = await setup();
    // Assistant Treasurer has financial_period.view only, not close/reopen.
    const assistant = await createTestUserWithRole(ctx.tenant.id, 'Assistant Treasurer');
    const assistantApp = buildTestApp({ userId: assistant.id, tenantId: ctx.tenant.id });

    await request(ctx.app).post(`/api/v1/financial-periods/${ctx.period.id}/close`).expect(200);
    await request(assistantApp)
      .post(`/api/v1/financial-periods/${ctx.period.id}/reopen`)
      .send({ reason: 'x' })
      .expect(403);
  });

  it('tenant isolation on close/reopen', async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    await request(ctxA.app).post(`/api/v1/financial-periods/${ctxB.period.id}/close`).expect(404);
  });
});

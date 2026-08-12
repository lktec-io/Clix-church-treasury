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

describe('POST /budgets', () => {
  it('creates a budget for a fund and category', async () => {
    const ctx = await setup();
    const res = await request(ctx.app)
      .post('/api/v1/budgets')
      .send({
        financialPeriodId: ctx.period.id,
        fundId: ctx.fund.id,
        categoryId: ctx.expenseCategory.id,
        type: 'expense',
        budgetAmount: '5000000.00',
      })
      .expect(201);
    expect(res.body.data.status).toBe('active');
  });

  it('rejects a negative budget amount', async () => {
    const ctx = await setup();
    await request(ctx.app)
      .post('/api/v1/budgets')
      .send({
        financialPeriodId: ctx.period.id,
        fundId: ctx.fund.id,
        type: 'expense',
        budgetAmount: '-100.00',
      })
      .expect(422);
  });

  it('allows a zero budget amount', async () => {
    const ctx = await setup();
    await request(ctx.app)
      .post('/api/v1/budgets')
      .send({
        financialPeriodId: ctx.period.id,
        fundId: ctx.fund.id,
        type: 'expense',
        budgetAmount: '0.00',
      })
      .expect(201);
  });

  it('rejects a duplicate budget for the same period/fund/category', async () => {
    const ctx = await setup();
    const payload = {
      financialPeriodId: ctx.period.id,
      fundId: ctx.fund.id,
      categoryId: ctx.expenseCategory.id,
      type: 'expense',
      budgetAmount: '100.00',
    };
    await request(ctx.app).post('/api/v1/budgets').send(payload).expect(201);
    const res = await request(ctx.app).post('/api/v1/budgets').send(payload).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects a duplicate fund-level budget (no category) for the same period/fund', async () => {
    const ctx = await setup();
    const payload = { financialPeriodId: ctx.period.id, fundId: ctx.fund.id, type: 'expense', budgetAmount: '100.00' };
    await request(ctx.app).post('/api/v1/budgets').send(payload).expect(201);
    // This exercises the check-before-insert path specifically, since the
    // DB unique index alone does not catch two NULL-category rows colliding.
    const res = await request(ctx.app).post('/api/v1/budgets').send(payload).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('a Viewer cannot create a budget', async () => {
    const ctx = await setup('Viewer');
    await request(ctx.app)
      .post('/api/v1/budgets')
      .send({ financialPeriodId: ctx.period.id, fundId: ctx.fund.id, type: 'expense', budgetAmount: '1.00' })
      .expect(403);
  });
});

describe('GET /budgets — budget vs actual', () => {
  it('actual and variance come from the financial engine, matching real ledger totals', async () => {
    const ctx = await setup();
    await request(ctx.app)
      .post('/api/v1/budgets')
      .send({
        financialPeriodId: ctx.period.id,
        fundId: ctx.fund.id,
        categoryId: ctx.expenseCategory.id,
        type: 'expense',
        budgetAmount: '5000000.00',
      })
      .expect(201);

    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'expense',
      accountId: ctx.account.id,
      fundId: ctx.fund.id,
      categoryId: ctx.expenseCategory.id,
      financialPeriodId: ctx.period.id,
      amount: '4200000.00',
      createdByUserId: ctx.user.id,
    });

    const res = await request(ctx.app).get(`/api/v1/budgets?financialPeriodId=${ctx.period.id}`).expect(200);
    const budget = res.body.data[0];
    expect(budget.actual_amount).toBe('4200000.00');
    // expense budget: variance = planned - actual (positive = under budget)
    expect(budget.variance).toBe('800000.00');
  });

  it('income budget variance is actual - planned (positive = ahead of plan)', async () => {
    const ctx = await setup();
    await request(ctx.app)
      .post('/api/v1/budgets')
      .send({
        financialPeriodId: ctx.period.id,
        fundId: ctx.fund.id,
        categoryId: ctx.incomeCategory.id,
        type: 'income',
        budgetAmount: '1000.00',
      })
      .expect(201);

    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income',
      accountId: ctx.account.id,
      fundId: ctx.fund.id,
      categoryId: ctx.incomeCategory.id,
      financialPeriodId: ctx.period.id,
      amount: '1200.00',
      createdByUserId: ctx.user.id,
    });

    const res = await request(ctx.app).get(`/api/v1/budgets?financialPeriodId=${ctx.period.id}`).expect(200);
    expect(res.body.data[0].variance).toBe('200.00');
  });
});

describe('tenant isolation', () => {
  it('tenant A cannot see tenant B budgets', async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    await request(ctxB.app)
      .post('/api/v1/budgets')
      .send({ financialPeriodId: ctxB.period.id, fundId: ctxB.fund.id, type: 'expense', budgetAmount: '1.00' })
      .expect(201);
    const res = await request(ctxA.app).get('/api/v1/budgets').expect(200);
    expect(res.body.data).toHaveLength(0);
  });
});

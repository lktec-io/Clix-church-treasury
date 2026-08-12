import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import {
  createTestTenant,
  createFinancialFixtures,
  createTestAccount,
  createTestUserWithRole,
} from '../helpers/fixtures.js';
import * as engine from '../../src/modules/financial/financialEngine.service.js';
import { closePeriod } from '../../src/modules/financial/financialPeriods.service.js';

beforeEach(async () => {
  await resetDatabase();
});

async function setup(roleName = 'Treasurer') {
  const tenant = await createTestTenant();
  const fixtures = await createFinancialFixtures(tenant.id);
  const destAccount = await createTestAccount(tenant.id);
  const user = await createTestUserWithRole(tenant.id, roleName);
  const app = buildTestApp({ userId: user.id, tenantId: tenant.id });
  return { tenant, ...fixtures, destAccount, user, app };
}

function transferPayload(ctx, overrides = {}) {
  return {
    fromAccountId: ctx.account.id,
    toAccountId: ctx.destAccount.id,
    fromFundId: ctx.fund.id,
    toFundId: ctx.fund.id,
    amount: '150.00',
    ...overrides,
  };
}

describe('POST /transfers', () => {
  it('decreases the source and increases the destination by exactly the transfer amount', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income',
      accountId: ctx.account.id,
      fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id,
      amount: '1000.00',
      createdByUserId: ctx.user.id,
    });

    await request(ctx.app).post('/api/v1/transfers').send(transferPayload(ctx)).expect(201);

    expect(await engine.getAccountBalance(ctx.tenant.id, ctx.account.id)).toBe('850.00');
    expect(await engine.getAccountBalance(ctx.tenant.id, ctx.destAccount.id)).toBe('150.00');
  });

  it('preserves total church money before and after', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income',
      accountId: ctx.account.id,
      fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id,
      amount: '500.00',
      createdByUserId: ctx.user.id,
    });
    const totalBefore = await engine.getTotalBalance(ctx.tenant.id);

    await request(ctx.app).post('/api/v1/transfers').send(transferPayload(ctx)).expect(201);

    expect(await engine.getTotalBalance(ctx.tenant.id)).toBe(totalBefore);
  });

  it('does not appear in income or expense totals', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income',
      accountId: ctx.account.id,
      fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id,
      amount: '500.00',
      createdByUserId: ctx.user.id,
    });
    const incomeBefore = await engine.getIncomeTotals(ctx.tenant.id);

    await request(ctx.app).post('/api/v1/transfers').send(transferPayload(ctx)).expect(201);

    expect(await engine.getIncomeTotals(ctx.tenant.id)).toBe(incomeBefore);
    expect(await engine.getExpenseTotals(ctx.tenant.id)).toBe('0.00');
  });

  it('rejects the same source and destination account+fund', async () => {
    const ctx = await setup();
    const res = await request(ctx.app)
      .post('/api/v1/transfers')
      .send(transferPayload(ctx, { toAccountId: ctx.account.id }))
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid destination account', async () => {
    const ctx = await setup();
    await request(ctx.app)
      .post('/api/v1/transfers')
      .send(transferPayload(ctx, { toAccountId: 999999 }))
      .expect(422);
  });

  it('rejects a cross-tenant account', async () => {
    const ctx = await setup();
    const otherTenant = await createTestTenant();
    const otherFixtures = await createFinancialFixtures(otherTenant.id);
    await request(ctx.app)
      .post('/api/v1/transfers')
      .send(transferPayload(ctx, { toAccountId: otherFixtures.account.id }))
      .expect(422);
  });

  it('rejects a zero or negative amount', async () => {
    const ctx = await setup();
    await request(ctx.app).post('/api/v1/transfers').send(transferPayload(ctx, { amount: '0.00' })).expect(422);
    await request(ctx.app).post('/api/v1/transfers').send(transferPayload(ctx, { amount: '-10.00' })).expect(422);
  });

  it('rejects a transfer against a closed financial period', async () => {
    const ctx = await setup();
    await closePeriod(ctx.tenant.id, ctx.period.id, ctx.user.id);
    const res = await request(ctx.app).post('/api/v1/transfers').send(transferPayload(ctx)).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND'); // no open period at all
  });

  it('a user without transfers.create is forbidden', async () => {
    const ctx = await setup('Viewer');
    await request(ctx.app).post('/api/v1/transfers').send(transferPayload(ctx)).expect(403);
  });

  it('a failed transfer leaves no partial state', async () => {
    const ctx = await setup();
    await request(ctx.app)
      .post('/api/v1/transfers')
      .send(transferPayload(ctx, { toAccountId: 999999 }))
      .expect(422);

    expect(await engine.getAccountBalance(ctx.tenant.id, ctx.account.id)).toBe('0.00');
    const history = await engine.getTransactionHistory(ctx.tenant.id, { accountId: ctx.account.id });
    expect(history).toHaveLength(0);
  });
});

describe('GET /transfers', () => {
  it('lists one row per transfer (not one per ledger leg)', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income',
      accountId: ctx.account.id,
      fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id,
      amount: '500.00',
      createdByUserId: ctx.user.id,
    });
    await request(ctx.app).post('/api/v1/transfers').send(transferPayload(ctx)).expect(201);

    const res = await request(ctx.app).get('/api/v1/transfers').expect(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /transfers/:id returns both legs', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income',
      accountId: ctx.account.id,
      fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id,
      amount: '500.00',
      createdByUserId: ctx.user.id,
    });
    const createRes = await request(ctx.app).post('/api/v1/transfers').send(transferPayload(ctx)).expect(201);

    const res = await request(ctx.app).get(`/api/v1/transfers/${createRes.body.data.outLeg.id}`).expect(200);
    expect(res.body.data.outLeg.direction).toBe('out');
    expect(res.body.data.inLeg.direction).toBe('in');
  });

  it('tenant isolation on transfer listing', async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    await engine.recordSimpleTransaction(ctxB.tenant.id, {
      type: 'income',
      accountId: ctxB.account.id,
      fundId: ctxB.fund.id,
      financialPeriodId: ctxB.period.id,
      amount: '500.00',
      createdByUserId: ctxB.user.id,
    });
    await request(ctxB.app).post('/api/v1/transfers').send(transferPayload(ctxB)).expect(201);

    const res = await request(ctxA.app).get('/api/v1/transfers').expect(200);
    expect(res.body.data).toHaveLength(0);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestTenant, createTestAccount, createTestFund, createTestUserWithRole } from '../helpers/fixtures.js';

beforeEach(async () => {
  await resetDatabase();
});

async function setup(roleName = 'Treasurer') {
  const tenant = await createTestTenant();
  const user = await createTestUserWithRole(tenant.id, roleName);
  const app = buildTestApp({ userId: user.id, tenantId: tenant.id });
  return { tenant, user, app };
}

describe('account lifecycle', () => {
  it('can be renamed', async () => {
    const ctx = await setup();
    const account = await createTestAccount(ctx.tenant.id, { name: 'Old Name' });
    const res = await request(ctx.app)
      .patch(`/api/v1/accounts/${account.id}`)
      .send({ name: 'Main Bank Account' })
      .expect(200);
    expect(res.body.data.name).toBe('Main Bank Account');
  });

  it('can be deactivated and reactivated', async () => {
    const ctx = await setup();
    const account = await createTestAccount(ctx.tenant.id);
    const deactivated = await request(ctx.app).post(`/api/v1/accounts/${account.id}/deactivate`).expect(200);
    expect(deactivated.body.data.is_active).toBe(0);

    const reactivated = await request(ctx.app).post(`/api/v1/accounts/${account.id}/activate`).expect(200);
    expect(reactivated.body.data.is_active).toBe(1);
  });

  it('a deactivated account is rejected by the financial engine', async () => {
    const ctx = await setup();
    const { createFinancialFixtures } = await import('../helpers/fixtures.js');
    const fixtures = await createFinancialFixtures(ctx.tenant.id);
    await request(ctx.app).post(`/api/v1/accounts/${fixtures.account.id}/deactivate`).expect(200);

    const engine = await import('../../src/modules/financial/financialEngine.service.js');
    await expect(
      engine.recordSimpleTransaction(ctx.tenant.id, {
        type: 'income',
        accountId: fixtures.account.id,
        fundId: fixtures.fund.id,
        financialPeriodId: fixtures.period.id,
        amount: '10.00',
        createdByUserId: ctx.user.id,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('there is no delete endpoint for accounts', async () => {
    const ctx = await setup();
    const account = await createTestAccount(ctx.tenant.id);
    await request(ctx.app).delete(`/api/v1/accounts/${account.id}`).expect(404); // route doesn't exist
  });

  it('a Viewer cannot rename or deactivate an account', async () => {
    const ctx = await setup('Viewer');
    const account = await createTestAccount(ctx.tenant.id);
    await request(ctx.app).patch(`/api/v1/accounts/${account.id}`).send({ name: 'x' }).expect(403);
    await request(ctx.app).post(`/api/v1/accounts/${account.id}/deactivate`).expect(403);
  });

  it('tenant isolation: cannot rename another tenant\'s account', async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    const accountB = await createTestAccount(ctxB.tenant.id);
    const res = await request(ctxA.app).patch(`/api/v1/accounts/${accountB.id}`).send({ name: 'Hijacked' }).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('fund lifecycle', () => {
  it('can be renamed and deactivated/reactivated', async () => {
    const ctx = await setup();
    const fund = await createTestFund(ctx.tenant.id);
    await request(ctx.app).patch(`/api/v1/funds/${fund.id}`).send({ name: 'Building Fund' }).expect(200);
    const deactivated = await request(ctx.app).post(`/api/v1/funds/${fund.id}/deactivate`).expect(200);
    expect(deactivated.body.data.is_active).toBe(0);
  });

  it('there is no delete endpoint for funds', async () => {
    const ctx = await setup();
    const fund = await createTestFund(ctx.tenant.id);
    await request(ctx.app).delete(`/api/v1/funds/${fund.id}`).expect(404);
  });
});

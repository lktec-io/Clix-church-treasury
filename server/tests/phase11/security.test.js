import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestTenant, createFinancialFixtures, createTestUserWithRole, createTestContributor } from '../helpers/fixtures.js';

beforeEach(async () => {
  await resetDatabase();
});

async function setup(roleName = 'Super Administrator') {
  const tenant = await createTestTenant();
  const fixtures = await createFinancialFixtures(tenant.id);
  const user = await createTestUserWithRole(tenant.id, roleName);
  const app = buildTestApp({ userId: user.id, tenantId: tenant.id });
  return { tenant, ...fixtures, user, app };
}

async function latestAuditAction(app, entityType, entityId) {
  const res = await request(app).get('/api/v1/audit-logs').expect(200);
  return res.body.data.find((row) => row.entity_type === entityType && row.entity_id === entityId);
}

describe('Phase 11 — account/fund audit logging (was previously entirely unlogged)', () => {
  it('logs account.created, account.renamed, account.deactivated, account.activated', async () => {
    const ctx = await setup();

    const created = await request(ctx.app).post('/api/v1/accounts').send({ name: 'Petty Cash', type: 'cash' }).expect(201);
    const accountId = created.body.data.id;
    expect((await latestAuditAction(ctx.app, 'accounts', accountId)).action).toBe('account.created');

    await request(ctx.app).patch(`/api/v1/accounts/${accountId}`).send({ name: 'Renamed Cash' }).expect(200);
    expect((await latestAuditAction(ctx.app, 'accounts', accountId)).action).toBe('account.renamed');

    await request(ctx.app).post(`/api/v1/accounts/${accountId}/deactivate`).expect(200);
    expect((await latestAuditAction(ctx.app, 'accounts', accountId)).action).toBe('account.deactivated');

    await request(ctx.app).post(`/api/v1/accounts/${accountId}/activate`).expect(200);
    expect((await latestAuditAction(ctx.app, 'accounts', accountId)).action).toBe('account.activated');
  });

  it('logs fund.created, fund.renamed, fund.deactivated, fund.activated', async () => {
    const ctx = await setup();

    const created = await request(ctx.app).post('/api/v1/funds').send({ name: 'Missions', isRestricted: true }).expect(201);
    const fundId = created.body.data.id;
    expect((await latestAuditAction(ctx.app, 'funds', fundId)).action).toBe('fund.created');

    await request(ctx.app).patch(`/api/v1/funds/${fundId}`).send({ name: 'World Missions' }).expect(200);
    expect((await latestAuditAction(ctx.app, 'funds', fundId)).action).toBe('fund.renamed');

    await request(ctx.app).post(`/api/v1/funds/${fundId}/deactivate`).expect(200);
    expect((await latestAuditAction(ctx.app, 'funds', fundId)).action).toBe('fund.deactivated');

    await request(ctx.app).post(`/api/v1/funds/${fundId}/activate`).expect(200);
    expect((await latestAuditAction(ctx.app, 'funds', fundId)).action).toBe('fund.activated');
  });
});

describe('Phase 11 — pledge overpayment guard uses integer-cents comparison, not float', () => {
  it('a payment that lands exactly on the remaining balance (decimal-fraction amounts) is accepted, not falsely rejected', async () => {
    const ctx = await setup('Treasurer');
    const contributor = await createTestContributor(ctx.tenant.id);
    const pledgeRes = await request(ctx.app)
      .post('/api/v1/pledges')
      .send({ contributorId: contributor.id, fundId: ctx.fund.id, pledgedAmount: '300.03', pledgeDate: '2026-01-01' })
      .expect(201);
    const pledgeId = pledgeRes.body.data.id;

    // 100.01 cannot be represented exactly in IEEE-754 binary — summing it
    // three times in floating point is the classic case that used to need
    // the epsilon fudge-factor this test guards against regressing to.
    for (let i = 0; i < 3; i += 1) {
      await request(ctx.app)
        .post('/api/v1/contributions')
        .send({
          amount: '100.01',
          accountId: ctx.account.id,
          fundId: ctx.fund.id,
          categoryId: ctx.incomeCategory.id,
          paymentMethod: 'cash',
          contributionDate: '2026-01-05',
          pledgeId,
        })
        .expect(201);
    }

    const pledge = await request(ctx.app).get(`/api/v1/pledges/${pledgeId}`).expect(200);
    expect(pledge.body.data.remaining_amount).toBe('0.00');
    expect(pledge.body.data.fulfilled_amount).toBe('300.03');
    expect(pledge.body.data.status).toBe('completed');
  });

  it('a payment one cent over the remaining balance is still correctly rejected', async () => {
    const ctx = await setup('Treasurer');
    const contributor = await createTestContributor(ctx.tenant.id);
    const pledgeRes = await request(ctx.app)
      .post('/api/v1/pledges')
      .send({ contributorId: contributor.id, fundId: ctx.fund.id, pledgedAmount: '100.00', pledgeDate: '2026-01-01' })
      .expect(201);

    const res = await request(ctx.app)
      .post('/api/v1/contributions')
      .send({
        amount: '100.01',
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
});

describe('Phase 11 — input validation rejects oversized free-text fields with a clean 422, not a raw DB error', () => {
  it('a contribution note longer than the DB column (500 chars) is rejected with VALIDATION_ERROR', async () => {
    const ctx = await setup('Treasurer');
    const res = await request(ctx.app)
      .post('/api/v1/contributions')
      .send({
        amount: '10.00',
        accountId: ctx.account.id,
        fundId: ctx.fund.id,
        categoryId: ctx.incomeCategory.id,
        paymentMethod: 'cash',
        contributionDate: '2026-01-05',
        notes: 'x'.repeat(501),
      })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.notes).toBeTruthy();
  });
});

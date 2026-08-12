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
import * as engine from '../../src/modules/financial/financialEngine.service.js';
import { closePeriod } from '../../src/modules/financial/financialPeriods.service.js';

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

function contributionPayload(fixtures, overrides = {}) {
  return {
    amount: '250.00',
    accountId: fixtures.account.id,
    fundId: fixtures.fund.id,
    categoryId: fixtures.incomeCategory.id,
    paymentMethod: 'cash',
    contributionDate: '2026-03-01',
    ...overrides,
  };
}

describe('POST /contributions — create', () => {
  it('records a contribution and posts it through the financial engine', async () => {
    const ctx = await setup();
    const res = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx))
      .expect(201);

    expect(res.body.data.status).toBe('posted');
    expect(res.body.data.transaction.type).toBe('income');
    expect(res.body.data.transaction.direction).toBe('in');

    const balance = await engine.getAccountBalance(ctx.tenant.id, ctx.account.id);
    expect(balance).toBe('250.00');
  });

  it('links the contribution and the ledger transaction to each other', async () => {
    const ctx = await setup();
    const res = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx))
      .expect(201);

    const history = await engine.getTransactionHistory(ctx.tenant.id, { accountId: ctx.account.id });
    const txn = history.find((t) => t.id === res.body.data.transaction_id);
    expect(txn.reference_type).toBe('contributions');
    expect(txn.reference_id).toBe(res.body.data.id);
  });

  it('records a contribution with a contributor reference', async () => {
    const ctx = await setup();
    const contributor = await createTestContributor(ctx.tenant.id);
    const res = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { contributorId: contributor.id }))
      .expect(201);
    expect(res.body.data.contributor_id).toBe(contributor.id);
  });

  it('allows an anonymous contribution with no contributor', async () => {
    const ctx = await setup();
    const res = await request(ctx.app).post('/api/v1/contributions').send(contributionPayload(ctx)).expect(201);
    expect(res.body.data.contributor_id).toBeNull();
  });

  it('rejects an invalid amount', async () => {
    const ctx = await setup();
    await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { amount: '-5.00' }))
      .expect(422);
    await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { amount: 10.5 }))
      .expect(422);
  });

  it('rejects a cross-tenant account/fund/category', async () => {
    const ctx = await setup();
    const otherTenant = await createTestTenant();
    const otherFixtures = await createFinancialFixtures(otherTenant.id);

    const res = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { accountId: otherFixtures.account.id }))
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid payment method', async () => {
    const ctx = await setup();
    await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { paymentMethod: 'bitcoin' }))
      .expect(422);
  });

  it('rejects posting against a closed financial period', async () => {
    const ctx = await setup();
    await closePeriod(ctx.tenant.id, ctx.period.id, ctx.user.id);

    const res = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx))
      .expect(409);
    expect(res.body.error.code).toBe('PERIOD_LOCKED');
  });

  it('a user without income.create is forbidden', async () => {
    const ctx = await setup('Viewer');
    const res = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx))
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('contribution reversal', () => {
  it('reverses the financial effect and marks the contribution reversed', async () => {
    const ctx = await setup();
    const createRes = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx))
      .expect(201);

    await request(ctx.app)
      .post(`/api/v1/contributions/${createRes.body.data.id}/reverse`)
      .send({ reason: 'Recorded twice by mistake' })
      .expect(200);

    expect(await engine.getAccountBalance(ctx.tenant.id, ctx.account.id)).toBe('0.00');
  });

  it('cannot reverse the same contribution twice', async () => {
    const ctx = await setup();
    const createRes = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx))
      .expect(201);

    await request(ctx.app)
      .post(`/api/v1/contributions/${createRes.body.data.id}/reverse`)
      .send({ reason: 'first' })
      .expect(200);
    const res = await request(ctx.app)
      .post(`/api/v1/contributions/${createRes.body.data.id}/reverse`)
      .send({ reason: 'second' })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('requires a reason', async () => {
    const ctx = await setup();
    const createRes = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx))
      .expect(201);
    await request(ctx.app)
      .post(`/api/v1/contributions/${createRes.body.data.id}/reverse`)
      .send({})
      .expect(422);
  });

  it('a user without income.reverse is forbidden', async () => {
    const treasurerCtx = await setup('Treasurer');
    const createRes = await request(treasurerCtx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(treasurerCtx))
      .expect(201);

    const viewerUser = await createTestUserWithRole(treasurerCtx.tenant.id, 'Viewer');
    const viewerApp = buildTestApp({ userId: viewerUser.id, tenantId: treasurerCtx.tenant.id });
    await request(viewerApp)
      .post(`/api/v1/contributions/${createRes.body.data.id}/reverse`)
      .send({ reason: 'x' })
      .expect(403);
  });
});

describe('tenant isolation and privacy', () => {
  it('tenant A cannot see tenant B contributions', async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    await request(ctxB.app).post('/api/v1/contributions').send(contributionPayload(ctxB)).expect(201);

    const res = await request(ctxA.app).get('/api/v1/contributions').expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('tenant A cannot fetch tenant B\'s contribution by id', async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    const createRes = await request(ctxB.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctxB))
      .expect(201);

    const res = await request(ctxA.app).get(`/api/v1/contributions/${createRes.body.data.id}`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('a role without contributors.view sees contributions without contributor identity', async () => {
    const ctx = await setup('Treasurer');
    const contributor = await createTestContributor(ctx.tenant.id, { fullName: 'Jane Donor' });
    await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { contributorId: contributor.id }))
      .expect(201);

    const auditorUser = await createTestUserWithRole(ctx.tenant.id, 'Auditor');
    const auditorApp = buildTestApp({ userId: auditorUser.id, tenantId: ctx.tenant.id });
    const res = await request(auditorApp).get('/api/v1/contributions').expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].contributor).toBeUndefined();
    // The amount is still visible — only identity is withheld.
    expect(res.body.data[0].amount).toBe('250.00');
  });

  it('a role with contributors.view sees the resolved contributor name', async () => {
    const ctx = await setup('Treasurer');
    const contributor = await createTestContributor(ctx.tenant.id, { fullName: 'Jane Donor' });
    await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { contributorId: contributor.id }))
      .expect(201);

    const res = await request(ctx.app).get('/api/v1/contributions').expect(200);
    expect(res.body.data[0].contributor.full_name).toBe('Jane Donor');
  });
});

describe('contribution update — non-financial fields only', () => {
  it('allows updating notes/reference but not amount', async () => {
    const ctx = await setup();
    const createRes = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx))
      .expect(201);

    const res = await request(ctx.app)
      .patch(`/api/v1/contributions/${createRes.body.data.id}`)
      .send({ notes: 'Corrected spelling of donor name' })
      .expect(200);
    expect(res.body.data.notes).toBe('Corrected spelling of donor name');

    // amount is not an accepted field on this endpoint at all — it's silently
    // not applied, the amount stays what the ledger says it is.
    expect(await engine.getAccountBalance(ctx.tenant.id, ctx.account.id)).toBe('250.00');
  });
});

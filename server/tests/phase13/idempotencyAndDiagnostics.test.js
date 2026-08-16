import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestTenant, createFinancialFixtures, createTestUserWithRole } from '../helpers/fixtures.js';
import { transactionsRepository } from '../../src/modules/financial/transactions.repository.js';

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
    amount: '10000.00',
    accountId: fixtures.account.id,
    fundId: fixtures.fund.id,
    categoryId: fixtures.incomeCategory.id,
    paymentMethod: 'cash',
    contributionDate: '2026-07-15',
    ...overrides,
  };
}

describe('contribution idempotency (migration 0032 regression)', () => {
  it('two requests with the same idempotencyKey produce only one contribution and one ledger row', async () => {
    const ctx = await setup();
    const idempotencyKey = 'test-key-12345';

    const first = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { idempotencyKey }))
      .expect(201);

    const second = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { idempotencyKey }))
      .expect(201);

    // Same contribution row returned both times — never a second one created.
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.deduplicated).toBe(true);
    // The deduplicated response must carry the exact same shape as a
    // first-time success (regression: an earlier version of this dedup
    // path omitted `.transaction`, a real API-contract inconsistency).
    expect(second.body.data.transaction).toBeTruthy();
    expect(second.body.data.transaction.id).toBe(first.body.data.transaction.id);
    expect(second.body.data.receipt.receipt_number).toBe(first.body.data.receipt.receipt_number);

    const history = await transactionsRepository.listHistory(ctx.tenant.id, { accountId: ctx.account.id });
    expect(history).toHaveLength(1);
    expect(history[0].amount).toBe('10000.00');
  });

  it('different idempotencyKeys (or none at all) create separate contributions as normal', async () => {
    const ctx = await setup();
    await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { idempotencyKey: 'key-a' }))
      .expect(201);
    await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { idempotencyKey: 'key-b' }))
      .expect(201);
    await request(ctx.app).post('/api/v1/contributions').send(contributionPayload(ctx)).expect(201);

    const history = await transactionsRepository.listHistory(ctx.tenant.id, { accountId: ctx.account.id });
    expect(history).toHaveLength(3);
  });

  it('a deduplicated response does not attempt to resend SMS', async () => {
    const ctx = await setup();
    const idempotencyKey = 'sms-dedup-key';
    const first = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { idempotencyKey }))
      .expect(201);
    expect(first.body.data.sms).toBeNull(); // no contributor on this payload

    const second = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { idempotencyKey }))
      .expect(201);
    expect(second.body.data.sms).toBeNull();
    expect(second.body.data.deduplicated).toBe(true);
  });
});

describe('GET /sms/status', () => {
  it('reports non-secret configuration state to an authorized admin', async () => {
    const ctx = await setup('Super Administrator');
    const res = await request(ctx.app).get('/api/v1/sms/status').expect(200);
    expect(res.body.data).toEqual({
      provider: 'noop',
      configured: false,
      senderConfigured: false,
      apiUrlConfigured: true,
    });
  });

  it('a role without settings.manage is forbidden', async () => {
    const ctx = await setup('Treasurer');
    await request(ctx.app).get('/api/v1/sms/status').expect(403);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestTenant, createFinancialFixtures, createTestUserWithRole, createTestContributor } from '../helpers/fixtures.js';
import { receiptsRepository } from '../../src/modules/receipts/receipts.repository.js';
import { smsLogRepository } from '../../src/modules/sms/smsLog.repository.js';

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

// Regression coverage for the production incident: receipts.repository.js
// extends TenantScopedRepository, whose insert() unconditionally sets
// `updated_at` (server/src/db/TenantScopedRepository.js) — the `receipts`
// table (migration 0024) was missing that column until migration 0031.
// If that migration is ever missing/reverted on a given database, this
// test fails with exactly the production error
// (ER_BAD_FIELD_ERROR: Unknown column 'updated_at' in 'field list'),
// rather than silently passing.
describe('receipts schema (migration 0031 regression)', () => {
  it('POST /contributions succeeds and produces a receipt with updated_at set', async () => {
    const ctx = await setup();
    const res = await request(ctx.app).post('/api/v1/contributions').send(contributionPayload(ctx)).expect(201);

    expect(res.body.data.status).toBe('posted');
    expect(res.body.data.receipt.receipt_number).toMatch(/^RCT-/);

    const receipt = await receiptsRepository.findById(ctx.tenant.id, res.body.data.receipt.id);
    expect(receipt).not.toBeNull();
    expect(receipt.updated_at).toBeTruthy();
    expect(receipt.created_at).toBeTruthy();
  });
});

describe('SMS failure does not block or roll back a valid contribution', () => {
  it('a contributor with an unrecognizable phone number still gets a 201 with sms.status = failed', async () => {
    const ctx = await setup();
    const contributor = await createTestContributor(ctx.tenant.id, { phone: 'not-a-real-number' });

    const res = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { contributorId: contributor.id }))
      .expect(201);

    // The contribution itself is fully successful regardless of SMS outcome.
    expect(res.body.data.status).toBe('posted');
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.receipt).toBeTruthy();

    // SMS was attempted and honestly reported as failed (invalid phone),
    // never silently dropped and never reported as sent.
    expect(res.body.data.sms.status).toBe('failed');
    expect(res.body.data.sms.errorMessage).toBeTruthy();

    const logs = await smsLogRepository.findAllByTenant(ctx.tenant.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('failed');
  });

  it('a contribution with no contributor at all still succeeds with sms: null', async () => {
    const ctx = await setup();
    const res = await request(ctx.app).post('/api/v1/contributions').send(contributionPayload(ctx)).expect(201);
    expect(res.body.data.status).toBe('posted');
    expect(res.body.data.sms).toBeNull();
  });
});

describe('POST /contributions/:id/resend-sms', () => {
  it('resends the confirmation and reflects the same failure/success shape', async () => {
    const ctx = await setup();
    const contributor = await createTestContributor(ctx.tenant.id, { phone: '+255700000000' });
    const createRes = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { contributorId: contributor.id }))
      .expect(201);

    const resendRes = await request(ctx.app)
      .post(`/api/v1/contributions/${createRes.body.data.id}/resend-sms`)
      .expect(200);
    // No BEEM_API_KEY in the test environment, so this is honestly
    // 'skipped_no_provider' — never fabricated as 'sent'.
    expect(resendRes.body.data.sms.status).toBe('skipped_no_provider');
  });

  it('returns 409 when the contributor has no phone on file', async () => {
    const ctx = await setup();
    const contributor = await createTestContributor(ctx.tenant.id); // no phone
    const createRes = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { contributorId: contributor.id }))
      .expect(201);
    expect(createRes.body.data.sms).toBeNull();

    const res = await request(ctx.app)
      .post(`/api/v1/contributions/${createRes.body.data.id}/resend-sms`)
      .expect(409);
    expect(res.body.error.code).toBe('NO_PHONE');
  });
});

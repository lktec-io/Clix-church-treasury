import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestTenant, createFinancialFixtures, createTestUserWithRole } from '../helpers/fixtures.js';
import { contributionItemsRepository } from '../../src/modules/contributions/contributionItems.repository.js';

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
    contributionDate: '2026-03-01',
    ...overrides,
  };
}

describe('contribution breakdown items', () => {
  it('accepts items that sum exactly to the total amount', async () => {
    const ctx = await setup();
    const res = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(
        contributionPayload(ctx, {
          items: [
            { purpose: 'Sadaka ya Kambi', amount: '5000.00' },
            { purpose: 'Ujenzi wa Kambi', amount: '5000.00' },
          ],
        })
      )
      .expect(201);

    expect(res.body.data.items).toHaveLength(2);
    const stored = await contributionItemsRepository.findByContributionId(ctx.tenant.id, res.body.data.id);
    expect(stored).toHaveLength(2);
    expect(stored.map((i) => i.purpose).sort()).toEqual(['Sadaka ya Kambi', 'Ujenzi wa Kambi'].sort());
  });

  it('rejects items that do not sum to the total amount', async () => {
    const ctx = await setup();
    const res = await request(ctx.app)
      .post('/api/v1/contributions')
      .send(
        contributionPayload(ctx, {
          items: [
            { purpose: 'Sadaka ya Kambi', amount: '5000.00' },
            { purpose: 'Ujenzi wa Kambi', amount: '4000.00' },
          ],
        })
      )
      .expect(422);
    expect(res.body.error.fields.items).toContain('sum');
  });

  it('rejects an item with a non-positive amount', async () => {
    const ctx = await setup();
    await request(ctx.app)
      .post('/api/v1/contributions')
      .send(contributionPayload(ctx, { items: [{ purpose: 'Bad', amount: '-1.00' }] }))
      .expect(422);
  });

  it('a contribution with no items behaves exactly as before (no items array in the response)', async () => {
    const ctx = await setup();
    const res = await request(ctx.app).post('/api/v1/contributions').send(contributionPayload(ctx)).expect(201);
    expect(res.body.data.items).toEqual([]);
  });
});

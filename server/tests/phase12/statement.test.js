import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { buildRealApp } from '../helpers/realApp.js';
import {
  createTestTenant,
  createFinancialFixtures,
  createTestUserWithRole,
  createTestContributor,
  createTestMemberContributor,
} from '../helpers/fixtures.js';
import { categoriesRepository } from '../../src/modules/categories/categories.repository.js';

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

describe('GET /contributors/:id/statement', () => {
  it('buckets contributions by category.report_group into tithe/offering/other', async () => {
    const ctx = await setup();
    const contributor = await createTestContributor(ctx.tenant.id);
    const titheCategory = await categoriesRepository.create(ctx.tenant.id, {
      type: 'income',
      name: 'Zaka',
      reportGroup: 'tithe',
    });
    const offeringCategory = await categoriesRepository.create(ctx.tenant.id, {
      type: 'income',
      name: 'Sadaka',
      reportGroup: 'offering',
    });
    // ctx.incomeCategory has no report_group set — falls into "other".

    const record = (categoryId, amount) =>
      request(ctx.app)
        .post('/api/v1/contributions')
        .send({
          amount,
          accountId: ctx.account.id,
          fundId: ctx.fund.id,
          categoryId,
          contributorId: contributor.id,
          paymentMethod: 'cash',
          contributionDate: '2026-07-15',
        })
        .expect(201);

    await record(titheCategory.id, '1000.00');
    await record(offeringCategory.id, '2000.00');
    await record(ctx.incomeCategory.id, '500.00');
    // A different month must not be included.
    await request(ctx.app)
      .post('/api/v1/contributions')
      .send({
        amount: '999.00',
        accountId: ctx.account.id,
        fundId: ctx.fund.id,
        categoryId: titheCategory.id,
        contributorId: contributor.id,
        paymentMethod: 'cash',
        contributionDate: '2026-06-01',
      })
      .expect(201);

    const res = await request(ctx.app)
      .get(`/api/v1/contributors/${contributor.id}/statement`)
      .query({ year: 2026, month: 7 })
      .expect(200);

    expect(res.body.data.tithe).toBe('1000.00');
    expect(res.body.data.offering).toBe('2000.00');
    expect(res.body.data.other).toBe('500.00');
    expect(res.body.data.total).toBe('3500.00');
    expect(res.body.data.contributions).toHaveLength(3);
  });
});

describe('member self-service statement', () => {
  it('GET /member/statement matches the treasurer-facing statement for the same contributor', async () => {
    const tenant = await createTestTenant();
    const fixtures = await createFinancialFixtures(tenant.id);
    const staffUser = await createTestUserWithRole(tenant.id, 'Treasurer');
    const staffApp = buildTestApp({ userId: staffUser.id, tenantId: tenant.id });
    const member = await createTestMemberContributor(tenant.id, { pin: '1234' });

    await request(staffApp)
      .post('/api/v1/contributions')
      .send({
        amount: '750.00',
        accountId: fixtures.account.id,
        fundId: fixtures.fund.id,
        categoryId: fixtures.incomeCategory.id,
        contributorId: member.id,
        paymentMethod: 'cash',
        contributionDate: '2026-05-10',
      })
      .expect(201);

    const memberApp = buildRealApp();
    const loginRes = await request(memberApp)
      .post('/api/v1/member/auth/login')
      .send({ tenantSlug: tenant.slug, memberNumber: member.member_number, pin: '1234' })
      .expect(200);

    const memberRes = await request(memberApp)
      .get('/api/v1/member/statement')
      .query({ year: 2026, month: 5 })
      .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`)
      .expect(200);

    expect(memberRes.body.data.total).toBe('750.00');
    expect(memberRes.body.data.other).toBe('750.00');
  });
});

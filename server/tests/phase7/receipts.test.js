import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestTenant, createFinancialFixtures, createTestUserWithRole } from '../helpers/fixtures.js';

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

async function recordContribution(ctx, overrides = {}) {
  return request(ctx.app)
    .post('/api/v1/contributions')
    .send({
      amount: '100.00',
      accountId: ctx.account.id,
      fundId: ctx.fund.id,
      categoryId: ctx.incomeCategory.id,
      paymentMethod: 'cash',
      contributionDate: '2026-01-05',
      ...overrides,
    })
    .expect(201);
}

describe('receipts — auto-issued alongside every contribution', () => {
  it('every contribution gets exactly one receipt with a well-formed number', async () => {
    const ctx = await setup();
    const res = await recordContribution(ctx);
    expect(res.body.data.receipt).toBeTruthy();
    expect(res.body.data.receipt.receipt_number).toMatch(/^RCT-\d{4}-\d{4}$/);
  });

  it('receipt numbers are sequential per tenant within a year', async () => {
    const ctx = await setup();
    const first = await recordContribution(ctx);
    const second = await recordContribution(ctx);
    const firstSeq = Number(first.body.data.receipt.receipt_number.split('-')[2]);
    const secondSeq = Number(second.body.data.receipt.receipt_number.split('-')[2]);
    expect(secondSeq).toBe(firstSeq + 1);
  });

  it('two tenants issuing receipts the same year do not collide or share a sequence', async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    const a = await recordContribution(ctxA);
    const b = await recordContribution(ctxB);
    // Both start their own tenant-scoped sequence at 0001.
    expect(a.body.data.receipt.receipt_number.endsWith('-0001')).toBe(true);
    expect(b.body.data.receipt.receipt_number.endsWith('-0001')).toBe(true);
  });

  it('concurrent contribution recording produces unique receipt numbers (no collision)', async () => {
    const ctx = await setup();
    const results = await Promise.all(Array.from({ length: 10 }, () => recordContribution(ctx)));
    const numbers = results.map((r) => r.body.data.receipt.receipt_number);
    expect(new Set(numbers).size).toBe(10);
  });

  it('GET /receipts/by-contribution/:id resolves the linked receipt', async () => {
    const ctx = await setup();
    const contribRes = await recordContribution(ctx);
    const res = await request(ctx.app)
      .get(`/api/v1/receipts/by-contribution/${contribRes.body.data.id}`)
      .expect(200);
    expect(res.body.data.receipt_number).toBe(contribRes.body.data.receipt.receipt_number);
  });

  it('GET /receipts/:id/pdf streams a PDF', async () => {
    const ctx = await setup();
    const contribRes = await recordContribution(ctx);
    const res = await request(ctx.app)
      .get(`/api/v1/receipts/${contribRes.body.data.receipt.id}/pdf`)
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.length).toBeGreaterThan(100); // a real PDF, not an empty stub
    // PDF magic bytes.
    expect(res.body.slice(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('a user without receipts.view cannot download a receipt PDF', async () => {
    const ctx = await setup('Treasurer');
    const contribRes = await recordContribution(ctx);

    // No role in the catalog lacks receipts.view except none currently —
    // Approver has dashboard.view/expense.*/reports.view only, no receipts.view.
    const approver = await createTestUserWithRole(ctx.tenant.id, 'Approver');
    const approverApp = buildTestApp({ userId: approver.id, tenantId: ctx.tenant.id });
    await request(approverApp).get(`/api/v1/receipts/${contribRes.body.data.receipt.id}/pdf`).expect(403);
  });

  it('tenant isolation: tenant A cannot download tenant B\'s receipt', async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    const contribB = await recordContribution(ctxB);
    await request(ctxA.app).get(`/api/v1/receipts/${contribB.body.data.receipt.id}/pdf`).expect(404);
  });
});

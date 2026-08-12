import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestTenant, createFinancialFixtures, createTestUserWithRole } from '../helpers/fixtures.js';
import * as engine from '../../src/modules/financial/financialEngine.service.js';
import { closePeriod } from '../../src/modules/financial/financialPeriods.service.js';

beforeEach(async () => {
  await resetDatabase();
});

async function setup() {
  const tenant = await createTestTenant();
  const fixtures = await createFinancialFixtures(tenant.id);
  const requester = await createTestUserWithRole(tenant.id, 'Assistant Treasurer'); // can create/submit, not approve
  const approver = await createTestUserWithRole(tenant.id, 'Approver');
  const treasurer = await createTestUserWithRole(tenant.id, 'Treasurer'); // can pay
  const requesterApp = buildTestApp({ userId: requester.id, tenantId: tenant.id });
  const approverApp = buildTestApp({ userId: approver.id, tenantId: tenant.id });
  const treasurerApp = buildTestApp({ userId: treasurer.id, tenantId: tenant.id });
  return { tenant, ...fixtures, requester, approver, treasurer, requesterApp, approverApp, treasurerApp };
}

function expensePayload(fixtures, overrides = {}) {
  return {
    amount: '80.00',
    categoryId: fixtures.expenseCategory.id,
    fundId: fixtures.fund.id,
    accountId: fixtures.account.id,
    payee: 'City Electric Co.',
    paymentMethod: 'bank',
    ...overrides,
  };
}

async function createDraft(ctx, overrides = {}) {
  const res = await request(ctx.requesterApp)
    .post('/api/v1/expenses')
    .send(expensePayload(ctx, overrides))
    .expect(201);
  return res.body.data;
}

describe('expense workflow — happy path', () => {
  it('draft has no financial effect', async () => {
    const ctx = await setup();
    await createDraft(ctx);
    expect(await engine.getAccountBalance(ctx.tenant.id, ctx.account.id)).toBe('0.00');
  });

  it('submitted has no financial effect', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(200);
    expect(await engine.getAccountBalance(ctx.tenant.id, ctx.account.id)).toBe('0.00');
  });

  it('rejected has no financial effect', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(200);
    await request(ctx.approverApp)
      .post(`/api/v1/expenses/${expense.id}/reject`)
      .send({ reason: 'Missing receipt' })
      .expect(200);
    expect(await engine.getAccountBalance(ctx.tenant.id, ctx.account.id)).toBe('0.00');
  });

  it('approved (not yet paid) has no financial effect', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(200);
    await request(ctx.approverApp).post(`/api/v1/expenses/${expense.id}/approve`).expect(200);
    expect(await engine.getAccountBalance(ctx.tenant.id, ctx.account.id)).toBe('0.00');
  });

  it('paid posts through the financial engine exactly once', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(200);
    await request(ctx.approverApp).post(`/api/v1/expenses/${expense.id}/approve`).expect(200);
    const payRes = await request(ctx.treasurerApp).post(`/api/v1/expenses/${expense.id}/pay`).expect(200);

    expect(payRes.body.data.status).toBe('paid');
    expect(payRes.body.data.transaction.type).toBe('expense');
    expect(payRes.body.data.transaction.direction).toBe('out');
    expect(await engine.getAccountBalance(ctx.tenant.id, ctx.account.id)).toBe('-80.00');
  });

  it('cannot pay the same expense twice', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(200);
    await request(ctx.approverApp).post(`/api/v1/expenses/${expense.id}/approve`).expect(200);
    await request(ctx.treasurerApp).post(`/api/v1/expenses/${expense.id}/pay`).expect(200);

    const secondPay = await request(ctx.treasurerApp).post(`/api/v1/expenses/${expense.id}/pay`).expect(409);
    expect(secondPay.body.error.code).toBe('CONFLICT');
    // Balance reflects exactly one posting, not two.
    expect(await engine.getAccountBalance(ctx.tenant.id, ctx.account.id)).toBe('-80.00');
  });
});

describe('expense workflow — invalid transitions', () => {
  it('cannot submit an already-submitted expense', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(200);
    const res = await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('cannot approve a draft (must be submitted first)', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.approverApp).post(`/api/v1/expenses/${expense.id}/approve`).expect(409);
  });

  it('cannot pay an expense that was rejected', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(200);
    await request(ctx.approverApp).post(`/api/v1/expenses/${expense.id}/reject`).send({ reason: 'no' }).expect(200);
    await request(ctx.treasurerApp).post(`/api/v1/expenses/${expense.id}/pay`).expect(409);
  });

  it('cannot pay an expense that is only approved but not through the approve step (still draft)', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.treasurerApp).post(`/api/v1/expenses/${expense.id}/pay`).expect(409);
  });

  it('return-for-correction sends a submitted expense back to draft, editable again', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(200);
    await request(ctx.approverApp)
      .post(`/api/v1/expenses/${expense.id}/return`)
      .send({ reason: 'Wrong fund selected' })
      .expect(200);

    const updated = await request(ctx.requesterApp)
      .patch(`/api/v1/expenses/${expense.id}`)
      .send(expensePayload(ctx, { amount: '95.00' }))
      .expect(200);
    expect(updated.body.data.amount).toBe('95.00');
  });

  it('rejects closed-period posting at pay time', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(200);
    await request(ctx.approverApp).post(`/api/v1/expenses/${expense.id}/approve`).expect(200);
    await closePeriod(ctx.tenant.id, ctx.period.id, ctx.treasurer.id);

    const res = await request(ctx.treasurerApp).post(`/api/v1/expenses/${expense.id}/pay`).expect(404);
    // No open period exists at all after closing the only one — service
    // throws NOT_FOUND ("no open period"), which is the correct behavior
    // when there's nothing to post against (distinct from PERIOD_LOCKED,
    // which fires when a *specific* period is referenced but closed).
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('expense workflow — segregation of duties and permissions', () => {
  it('the requester cannot approve their own expense', async () => {
    const ctx = await setup();
    // Give the requester approve permission too, to isolate the
    // self-approval check from a plain permission failure.
    const { rolesRepository } = await import('../../src/modules/roles/roles.repository.js');
    const { pool } = await import('../../src/config/db.js');
    const superAdminRole = await rolesRepository.findSystemRoleByName('Super Administrator');
    await pool.query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [
      ctx.requester.id,
      superAdminRole.id,
    ]);

    const expense = await createDraft(ctx);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(200);
    const res = await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/approve`).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('a Viewer cannot create an expense', async () => {
    const ctx = await setup();
    const viewer = await createTestUserWithRole(ctx.tenant.id, 'Viewer');
    const viewerApp = buildTestApp({ userId: viewer.id, tenantId: ctx.tenant.id });
    await request(viewerApp).post('/api/v1/expenses').send(expensePayload(ctx)).expect(403);
  });

  it('an Approver cannot pay an expense (no expense.pay)', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(200);
    await request(ctx.approverApp).post(`/api/v1/expenses/${expense.id}/approve`).expect(200);
    await request(ctx.approverApp).post(`/api/v1/expenses/${expense.id}/pay`).expect(403);
  });

  it('the Assistant Treasurer (requester role) cannot approve (no expense.approve)', async () => {
    const ctx = await setup();
    const expense = await createDraft(ctx);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/submit`).expect(200);
    await request(ctx.requesterApp).post(`/api/v1/expenses/${expense.id}/approve`).expect(403);
  });
});

describe('expense — attachment validation', () => {
  it('accepts a valid attachment metadata shape', async () => {
    const ctx = await setup();
    const res = await request(ctx.requesterApp)
      .post('/api/v1/expenses')
      .send(expensePayload(ctx, { attachment: { mime: 'application/pdf', sizeBytes: 1024 } }))
      .expect(201);
    expect(res.body.data.attachment_mime).toBe('application/pdf');
  });

  it('rejects a disallowed MIME type', async () => {
    const ctx = await setup();
    await request(ctx.requesterApp)
      .post('/api/v1/expenses')
      .send(expensePayload(ctx, { attachment: { mime: 'application/x-msdownload', sizeBytes: 1024 } }))
      .expect(422);
  });

  it('rejects an oversized attachment', async () => {
    const ctx = await setup();
    await request(ctx.requesterApp)
      .post('/api/v1/expenses')
      .send(expensePayload(ctx, { attachment: { mime: 'application/pdf', sizeBytes: 50 * 1024 * 1024 } }))
      .expect(422);
  });
});

describe('expense — tenant isolation', () => {
  it('tenant A cannot see or act on tenant B expenses', async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    const expenseB = await createDraft(ctxB);

    await request(ctxA.requesterApp).get(`/api/v1/expenses/${expenseB.id}`).expect(404);
    await request(ctxA.approverApp).post(`/api/v1/expenses/${expenseB.id}/approve`).expect(404);
  });
});

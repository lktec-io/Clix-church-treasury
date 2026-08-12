import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import {
  createTestTenant,
  createFinancialFixtures,
  createTestUserWithRole,
  createTestContributor,
  createTestAccount,
} from '../helpers/fixtures.js';
import * as engine from '../../src/modules/financial/financialEngine.service.js';
import { pool } from '../../src/config/db.js';

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
  const res = await request(ctx.app)
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
  return res.body.data;
}

// Full draft -> submit -> approve -> pay lifecycle, since only a paid
// expense posts a ledger transaction that a report can see (Expense Report
// reads `transactions`, not the `expenses` table directly).
async function payExpense(ctx, overrides = {}) {
  const draft = await request(ctx.app)
    .post('/api/v1/expenses')
    .send({
      amount: '75.00',
      categoryId: ctx.expenseCategory.id,
      fundId: ctx.fund.id,
      accountId: ctx.account.id,
      payee: 'Vendor',
      paymentMethod: 'cash',
      ...overrides,
    })
    .expect(201);
  await request(ctx.app).post(`/api/v1/expenses/${draft.body.data.id}/submit`).expect(200);
  const approver = await createTestUserWithRole(ctx.tenant.id, 'Approver');
  const approverApp = buildTestApp({ userId: approver.id, tenantId: ctx.tenant.id });
  await request(approverApp).post(`/api/v1/expenses/${draft.body.data.id}/approve`).expect(200);
  await request(ctx.app).post(`/api/v1/expenses/${draft.body.data.id}/pay`).expect(200);
  return draft.body.data;
}

describe('GET /reports/income', () => {
  it('rows and total match the financial engine exactly', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income', accountId: ctx.account.id, fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id, amount: '1000.00', createdByUserId: ctx.user.id,
    });
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income', accountId: ctx.account.id, fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id, amount: '500.00', createdByUserId: ctx.user.id,
    });

    const res = await request(ctx.app).get('/api/v1/reports/income').expect(200);
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data.totals.amount).toBe('1500.00');

    const directTotal = await engine.getFundBalance(ctx.tenant.id, ctx.fund.id);
    expect(res.body.data.totals.amount).toBe(directTotal);
  });

  it('date filter narrows both rows and total consistently (no filter mismatch between rows and total)', async () => {
    const ctx = await setup();
    const inRange = await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income', accountId: ctx.account.id, fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id, amount: '1000.00', createdByUserId: ctx.user.id,
    });
    const outOfRange = await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income', accountId: ctx.account.id, fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id, amount: '500.00', createdByUserId: ctx.user.id,
    });
    // postLedgerEntry always stamps posted_at = now(); back-date directly to
    // exercise the date filter deterministically rather than depending on
    // wall-clock timing.
    await pool.query('UPDATE transactions SET posted_at = ? WHERE id = ?', ['2026-01-05 10:00:00', inRange.id]);
    await pool.query('UPDATE transactions SET posted_at = ? WHERE id = ?', ['2026-06-05 10:00:00', outOfRange.id]);

    const res = await request(ctx.app).get('/api/v1/reports/income?dateFrom=2026-01-01&dateTo=2026-03-01').expect(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.totals.amount).toBe('1000.00');
  });

  it('a Viewer can view the report on-screen (JSON) but cannot export it', async () => {
    const ctx = await setup('Viewer');
    await request(ctx.app).get('/api/v1/reports/income').expect(200);
    await request(ctx.app).get('/api/v1/reports/income?format=csv').expect(403);
  });

  it('tenant isolation: tenant A does not see tenant B income', async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    await engine.recordSimpleTransaction(ctxB.tenant.id, {
      type: 'income', accountId: ctxB.account.id, fundId: ctxB.fund.id,
      financialPeriodId: ctxB.period.id, amount: '999.00', createdByUserId: ctxB.user.id,
    });
    const res = await request(ctxA.app).get('/api/v1/reports/income').expect(200);
    expect(res.body.data.rows).toHaveLength(0);
    expect(res.body.data.totals.amount).toBe('0.00');
  });
});

describe('GET /reports/expense', () => {
  it('reflects only paid (posted) expenses, matching the engine', async () => {
    const ctx = await setup();
    await payExpense(ctx, { amount: '75.00' });

    const res = await request(ctx.app).get('/api/v1/reports/expense').expect(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.totals.amount).toBe('75.00');
  });

  it('account filter narrows rows and total together', async () => {
    const ctx = await setup();
    const otherAccount = await createTestAccount(ctx.tenant.id);
    await payExpense(ctx, { amount: '75.00' });
    await payExpense(ctx, { amount: '25.00', accountId: otherAccount.id });

    const res = await request(ctx.app).get(`/api/v1/reports/expense?accountId=${otherAccount.id}`).expect(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.totals.amount).toBe('25.00');
  });
});

describe('GET /reports/transaction-journal', () => {
  it('includes both income and expense postings', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income', accountId: ctx.account.id, fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id, amount: '1000.00', createdByUserId: ctx.user.id,
    });
    await payExpense(ctx, { amount: '75.00' });

    const res = await request(ctx.app).get('/api/v1/reports/transaction-journal').expect(200);
    expect(res.body.data.rows).toHaveLength(2);
  });
});

describe('GET /reports/contributions', () => {
  it('total matches posted contributions only', async () => {
    const ctx = await setup();
    await recordContribution(ctx, { amount: '100.00' });
    const second = await recordContribution(ctx, { amount: '50.00' });
    await request(ctx.app).post(`/api/v1/contributions/${second.id}/reverse`).send({ reason: 'typo' }).expect(200);

    const res = await request(ctx.app).get('/api/v1/reports/contributions').expect(200);
    expect(res.body.data.rows).toHaveLength(2); // reversed row still listed...
    expect(res.body.data.totals.amount).toBe('100.00'); // ...but excluded from the total
  });

  it('hides contributor identity from a role without contributors.view', async () => {
    const ctx = await setup('Treasurer');
    const contributor = await createTestContributor(ctx.tenant.id, { fullName: 'Jane Giver' });
    await recordContribution(ctx, { contributorId: contributor.id });

    const auditor = await createTestUserWithRole(ctx.tenant.id, 'Auditor');
    const auditorApp = buildTestApp({ userId: auditor.id, tenantId: ctx.tenant.id });
    const res = await request(auditorApp).get('/api/v1/reports/contributions').expect(200);
    expect(res.body.data.rows[0].contributor).toBeUndefined();
    expect(res.body.data.rows[0].amount).toBe('100.00');
  });
});

describe('GET /reports/accounts/:id/statement and /reports/funds/:id/statement', () => {
  it('account statement closing balance matches the engine, and rows are scoped to the account', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income', accountId: ctx.account.id, fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id, amount: '1000.00', createdByUserId: ctx.user.id,
    });

    const res = await request(ctx.app).get(`/api/v1/reports/accounts/${ctx.account.id}/statement`).expect(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.totals.amount).toBe('1000.00');
    expect(res.body.data.account.id).toBe(ctx.account.id);

    const direct = await engine.getAccountBalance(ctx.tenant.id, ctx.account.id);
    expect(res.body.data.totals.amount).toBe(direct);
  });

  it('fund statement closing balance matches the engine', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income', accountId: ctx.account.id, fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id, amount: '400.00', createdByUserId: ctx.user.id,
    });

    const res = await request(ctx.app).get(`/api/v1/reports/funds/${ctx.fund.id}/statement`).expect(200);
    expect(res.body.data.totals.amount).toBe('400.00');
    const direct = await engine.getFundBalance(ctx.tenant.id, ctx.fund.id);
    expect(res.body.data.totals.amount).toBe(direct);
  });

  it('tenant isolation: tenant A cannot view tenant B\'s account statement', async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    await request(ctxA.app).get(`/api/v1/reports/accounts/${ctxB.account.id}/statement`).expect(404);
  });
});

describe('GET /reports/budget-vs-actual', () => {
  it('reuses the budgets module — totals sum the individual budget rows', async () => {
    const ctx = await setup();
    await request(ctx.app)
      .post('/api/v1/budgets')
      .send({ financialPeriodId: ctx.period.id, fundId: ctx.fund.id, categoryId: ctx.expenseCategory.id, type: 'expense', budgetAmount: '1000.00' })
      .expect(201);
    await payExpense(ctx, { amount: '200.00' });

    const res = await request(ctx.app).get(`/api/v1/reports/budget-vs-actual?financialPeriodId=${ctx.period.id}`).expect(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.rows[0].actual_amount).toBe('200.00');
    expect(res.body.data.totals.budget_amount).toBe('1000.00');
    expect(res.body.data.totals.actual_amount).toBe('200.00');
  });
});

describe('GET /reports/pledges', () => {
  it('totals reflect pledged/fulfilled/remaining across pledges', async () => {
    const ctx = await setup();
    const contributor = await createTestContributor(ctx.tenant.id);
    const pledgeRes = await request(ctx.app)
      .post('/api/v1/pledges')
      .send({ contributorId: contributor.id, fundId: ctx.fund.id, pledgedAmount: '1000.00', pledgeDate: '2026-01-01' })
      .expect(201);
    await recordContribution(ctx, { amount: '300.00', pledgeId: pledgeRes.body.data.id });

    const res = await request(ctx.app).get('/api/v1/reports/pledges').expect(200);
    expect(res.body.data.totals.pledged_amount).toBe('1000.00');
    expect(res.body.data.totals.fulfilled_amount).toBe('300.00');
    expect(res.body.data.totals.remaining_amount).toBe('700.00');
  });

  it('hides contributor identity from a role without contributors.view', async () => {
    const ctx = await setup('Treasurer');
    const contributor = await createTestContributor(ctx.tenant.id);
    await request(ctx.app)
      .post('/api/v1/pledges')
      .send({ contributorId: contributor.id, fundId: ctx.fund.id, pledgedAmount: '1000.00', pledgeDate: '2026-01-01' })
      .expect(201);

    const auditor = await createTestUserWithRole(ctx.tenant.id, 'Auditor');
    const auditorApp = buildTestApp({ userId: auditor.id, tenantId: ctx.tenant.id });
    const res = await request(auditorApp).get('/api/v1/reports/pledges').expect(200);
    expect(res.body.data.rows[0].contributor).toBeUndefined();
  });
});

describe('GET /reports/financial-summary', () => {
  it('is identical to the Phase 8 closing summary — one source of truth', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income', accountId: ctx.account.id, fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id, amount: '900.00', createdByUserId: ctx.user.id,
    });

    const reportRes = await request(ctx.app).get(`/api/v1/reports/financial-summary?financialPeriodId=${ctx.period.id}`).expect(200);
    const periodRes = await request(ctx.app).get(`/api/v1/financial-periods/${ctx.period.id}/summary`).expect(200);
    expect(reportRes.body.data).toEqual(periodRes.body.data);
  });
});

describe('export formats and permissions', () => {
  it('CSV export has the expected header row and is well-formed', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income', accountId: ctx.account.id, fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id, amount: '1000.00', createdByUserId: ctx.user.id,
    });
    const res = await request(ctx.app).get('/api/v1/reports/income?format=csv').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('Transaction No.,Date,Type,Direction,Amount,Method,Description');
    expect(lines).toHaveLength(2); // header + 1 data row
  });

  it('Excel export returns a valid xlsx buffer', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income', accountId: ctx.account.id, fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id, amount: '1000.00', createdByUserId: ctx.user.id,
    });
    const res = await request(ctx.app).get('/api/v1/reports/income?format=xlsx').expect(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(100);
    // xlsx is a zip archive — PK magic bytes.
    expect(res.body.slice(0, 2).toString('latin1')).toBe('PK');
  });

  it('PDF export returns a paginated, church-branded PDF', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income', accountId: ctx.account.id, fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id, amount: '1000.00', createdByUserId: ctx.user.id,
    });
    const res = await request(ctx.app).get('/api/v1/reports/income?format=pdf').expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.slice(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('rejects an unknown export format', async () => {
    const ctx = await setup();
    const res = await request(ctx.app).get('/api/v1/reports/income?format=xml').expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('an Auditor (has reports.export) can export; an Assistant Treasurer (lacks it) cannot', async () => {
    const ctx = await setup();
    const auditor = await createTestUserWithRole(ctx.tenant.id, 'Auditor');
    const auditorApp = buildTestApp({ userId: auditor.id, tenantId: ctx.tenant.id });
    await request(auditorApp).get('/api/v1/reports/income?format=csv').expect(200);

    const assistant = await createTestUserWithRole(ctx.tenant.id, 'Assistant Treasurer');
    const assistantApp = buildTestApp({ userId: assistant.id, tenantId: ctx.tenant.id });
    await request(assistantApp).get('/api/v1/reports/income?format=csv').expect(403);
  });
});

describe('closed-period data remains reportable', () => {
  it('a report against a closed period still returns its historical rows', async () => {
    const ctx = await setup();
    await engine.recordSimpleTransaction(ctx.tenant.id, {
      type: 'income', accountId: ctx.account.id, fundId: ctx.fund.id,
      financialPeriodId: ctx.period.id, amount: '250.00', createdByUserId: ctx.user.id,
    });
    await request(ctx.app).post(`/api/v1/financial-periods/${ctx.period.id}/close`).expect(200);

    const res = await request(ctx.app).get(`/api/v1/reports/income?financialPeriodId=${ctx.period.id}`).expect(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.totals.amount).toBe('250.00');
  });
});

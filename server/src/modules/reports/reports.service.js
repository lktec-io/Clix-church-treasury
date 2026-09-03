import { notFound } from '../../errors/AppError.js';
import { transactionsRepository } from '../financial/transactions.repository.js';
import { accountsRepository } from '../accounts/accounts.repository.js';
import { fundsRepository } from '../funds/funds.repository.js';
import { contributionsRepository } from '../contributions/contributions.repository.js';
import { enrichWithContributorInfo } from '../contributors/contributorEnrichment.js';
import { listBudgetsWithActual } from '../budgets/budgets.service.js';
import { listPledges } from '../pledges/pledges.service.js';
import { getFinancialSummary } from '../financial/financialSummary.service.js';
import { subtractMoney, sumMoney } from '../financial/money.js';

// Every report here composes an existing repository/service method — none
// of them run their own aggregation SQL. This is what
// docs/MASTER_TODO.md Phase 9 means by "one source of truth": a report and
// the dashboard/ledger it's describing structurally cannot disagree,
// because they're the same query.

// Rolling monthly income/expense series for the dashboard trend panel,
// plus a forecast for the month after the window.
//
// THE FORECAST IS A DERIVED ESTIMATE, NOT RECORDED MONEY. It is a trailing
// average of the last `FORECAST_BASIS_MONTHS` months with actual activity —
// deliberately the simplest defensible projection rather than a regression
// that would imply more confidence than a church's giving data supports.
// It is returned under its own `forecast` key (never mixed into `series`)
// and carries `basisMonths` so the UI can state what it was computed from.
// If there is not enough history, forecast is null and the UI draws nothing.
const FORECAST_BASIS_MONTHS = 3;

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getMonthlyTrends(tenantId, { months = 12 } = {}) {
  const now = new Date();
  // First day of the window, `months - 1` months back, so the current month
  // is the last bucket.
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const dateFrom = start.toISOString().slice(0, 10);
  const dateTo = end.toISOString().slice(0, 10);

  const [incomeRows, expenseRows] = await Promise.all([
    transactionsRepository.monthlyTotalsByType(tenantId, 'income', { dateFrom, dateTo }),
    transactionsRepository.monthlyTotalsByType(tenantId, 'expense', { dateFrom, dateTo }),
  ]);

  const incomeByPeriod = new Map(incomeRows.map((r) => [r.period, String(r.total)]));
  const expenseByPeriod = new Map(expenseRows.map((r) => [r.period, String(r.total)]));

  // Every month in the window appears, including quiet ones — a gap in the
  // x-axis would make a month with no giving look like missing data rather
  // than what it is.
  const series = [];
  for (let i = 0; i < months; i += 1) {
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const period = monthKey(cursor);
    series.push({
      period,
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
      income: incomeByPeriod.get(period) ?? '0.00',
      expense: expenseByPeriod.get(period) ?? '0.00',
    });
  }

  // Basis: the most recent months that actually had income. Months with
  // nothing recorded are skipped rather than averaged in as zeroes, which
  // would drag a new tenant's forecast toward zero purely because the
  // system was not in use yet.
  const basis = series
    .filter((point) => Number(point.income) > 0)
    .slice(-FORECAST_BASIS_MONTHS);

  let forecast = null;
  if (basis.length > 0) {
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const average = sumMoney(basis.map((point) => point.income));
    // Integer-cents division, so the projection is a clean money string
    // rather than a float artefact like 41666.666666666664.
    const cents = Math.round((Number(average) * 100) / basis.length);
    forecast = {
      period: monthKey(nextMonth),
      year: nextMonth.getUTCFullYear(),
      month: nextMonth.getUTCMonth() + 1,
      amount: (cents / 100).toFixed(2),
      basisMonths: basis.length,
    };
  }

  return { series, forecast, dateFrom, dateTo };
}

export async function getIncomeReport(tenantId, filters) {
  const rows = await transactionsRepository.listHistory(tenantId, { ...filters, type: 'income', limit: 1000 });
  const total = await transactionsRepository.sumByType(tenantId, 'income', filters);
  return { rows, total };
}

export async function getExpenseReport(tenantId, filters) {
  const rows = await transactionsRepository.listHistory(tenantId, { ...filters, type: 'expense', limit: 1000 });
  const total = await transactionsRepository.sumByType(tenantId, 'expense', filters);
  return { rows, total };
}

export async function getTransactionJournal(tenantId, filters) {
  const rows = await transactionsRepository.listHistory(tenantId, { ...filters, limit: 1000 });
  return { rows };
}

export async function getContributionsReport(tenantId, filters, { canViewContributors }) {
  const rows = await contributionsRepository.search(tenantId, { ...filters, limit: 1000 });
  const enriched = await enrichWithContributorInfo(tenantId, rows, canViewContributors);
  const total = sumMoney(rows.filter((r) => r.status === 'posted').map((r) => r.amount));
  return { rows: enriched, total };
}

export async function getAccountStatement(tenantId, accountId, { dateFrom, dateTo, financialPeriodId } = {}) {
  const account = await accountsRepository.findById(tenantId, accountId);
  if (!account) throw notFound('Account not found');

  const openingBalance = dateFrom
    ? await transactionsRepository.sumSignedThroughDate(tenantId, dateFrom, { accountId, inclusive: false })
    : '0.00';
  const rows = await transactionsRepository.listHistory(tenantId, {
    accountId,
    dateFrom,
    dateTo,
    financialPeriodId,
    status: 'posted',
    limit: 1000,
  });
  const closingBalance = await transactionsRepository.sumSigned(tenantId, { accountId, financialPeriodId });
  return { account, openingBalance, rows, closingBalance };
}

export async function getFundStatement(tenantId, fundId, { dateFrom, dateTo, financialPeriodId } = {}) {
  const fund = await fundsRepository.findById(tenantId, fundId);
  if (!fund) throw notFound('Fund not found');

  const openingBalance = dateFrom
    ? await transactionsRepository.sumSignedThroughDate(tenantId, dateFrom, { fundId, inclusive: false })
    : '0.00';
  const rows = await transactionsRepository.listHistory(tenantId, {
    fundId,
    dateFrom,
    dateTo,
    financialPeriodId,
    status: 'posted',
    limit: 1000,
  });
  const closingBalance = await transactionsRepository.sumSigned(tenantId, { fundId, financialPeriodId });
  return { fund, openingBalance, rows, closingBalance };
}

export async function getBudgetVsActualReport(tenantId, financialPeriodId) {
  const budgets = await listBudgetsWithActual(tenantId, { financialPeriodId });
  const sum = (key) => sumMoney(budgets.map((b) => b[key]));
  return {
    rows: budgets,
    totals: { budget_amount: sum('budget_amount'), actual_amount: sum('actual_amount'), variance: sum('variance') },
  };
}

export async function getPledgeReport(tenantId, filters, { canViewContributors }) {
  const pledges = await listPledges(tenantId, filters);
  const enriched = await enrichWithContributorInfo(tenantId, pledges, canViewContributors);
  const totalPledged = sumMoney(pledges.map((p) => p.pledged_amount));
  const totalFulfilled = sumMoney(pledges.map((p) => p.fulfilled_amount));
  return { rows: enriched, totalPledged, totalFulfilled, totalRemaining: subtractMoney(totalPledged, totalFulfilled) };
}

export async function getFinancialSummaryReport(tenantId, financialPeriodId) {
  return getFinancialSummary(tenantId, financialPeriodId);
}

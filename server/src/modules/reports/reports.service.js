import { notFound } from '../../errors/AppError.js';
import { transactionsRepository } from '../financial/transactions.repository.js';
import { accountsRepository } from '../accounts/accounts.repository.js';
import { fundsRepository } from '../funds/funds.repository.js';
import { contributionsRepository } from '../contributions/contributions.repository.js';
import { enrichWithContributorInfo } from '../contributors/contributorEnrichment.js';
import { listBudgetsWithActual } from '../budgets/budgets.service.js';
import { listPledges } from '../pledges/pledges.service.js';
import { getFinancialSummary } from '../financial/financialSummary.service.js';
import { subtractMoney } from '../financial/money.js';

// Every report here composes an existing repository/service method — none
// of them run their own aggregation SQL. This is what
// docs/MASTER_TODO.md Phase 9 means by "one source of truth": a report and
// the dashboard/ledger it's describing structurally cannot disagree,
// because they're the same query.

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
  const total = rows.reduce((sum, r) => (r.status === 'posted' ? sum + Number(r.amount) : sum), 0).toFixed(2);
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
  const sum = (key) => budgets.reduce((acc, b) => acc + Number(b[key]), 0).toFixed(2);
  return {
    rows: budgets,
    totals: { budget_amount: sum('budget_amount'), actual_amount: sum('actual_amount'), variance: sum('variance') },
  };
}

export async function getPledgeReport(tenantId, filters, { canViewContributors }) {
  const pledges = await listPledges(tenantId, filters);
  const enriched = await enrichWithContributorInfo(tenantId, pledges, canViewContributors);
  const totalPledged = pledges.reduce((sum, p) => sum + Number(p.pledged_amount), 0).toFixed(2);
  const totalFulfilled = pledges.reduce((sum, p) => sum + Number(p.fulfilled_amount), 0).toFixed(2);
  return { rows: enriched, totalPledged, totalFulfilled, totalRemaining: subtractMoney(totalPledged, totalFulfilled) };
}

export async function getFinancialSummaryReport(tenantId, financialPeriodId) {
  return getFinancialSummary(tenantId, financialPeriodId);
}

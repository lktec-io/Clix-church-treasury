import { notFound } from '../../errors/AppError.js';
import { transactionsRepository } from '../financial/transactions.repository.js';
import { accountsRepository } from '../accounts/accounts.repository.js';
import { fundsRepository } from '../funds/funds.repository.js';
import { contributionsRepository } from '../contributions/contributions.repository.js';
import { enrichWithContributorInfo } from '../contributors/contributorEnrichment.js';
import { listBudgetsWithActual } from '../budgets/budgets.service.js';
import { listPledges } from '../pledges/pledges.service.js';
import { getFinancialSummary } from '../financial/financialSummary.service.js';
import { addMoney, compareMoney, normalizeMoney, subtractMoney, sumMoney } from '../financial/money.js';
import { chartOfAccountsRepository } from '../financial/chartOfAccounts.repository.js';
import { CHART_OF_ACCOUNTS_TEMPLATE, NORMAL_BALANCE_BY_TYPE } from '../../db/seeds/chartOfAccountsTemplate.js';
import { withSchemaFallback } from '../../db/schemaGuard.js';

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

// ---------------------------------------------------------------------------
// ROW CAP.
//
// A list-style report renders every row it is given — into a table, a
// spreadsheet or a PDF — so it cannot fetch an unbounded result set; a church
// with years of history would otherwise build a multi-hundred-thousand-row
// response in memory.
//
// The cap itself is not the hazard. Hiding it is: a report that quietly stops
// at row 1,000 looks exactly like a complete one, and a treasurer reconciling
// against it has no way to tell. So every capped report fetches ONE ROW MORE
// than it will show, and if that extra row arrives it reports `truncated`
// with the cap that applied. The UI and the exports then say so in words.
//
// Totals are never derived from the capped rows — they come from an aggregate
// over the whole filtered set, so the total stays correct even when the list
// is only its first page.
// ---------------------------------------------------------------------------
export const REPORT_ROW_LIMIT = 1000;
const FETCH_LIMIT = REPORT_ROW_LIMIT + 1;

function capRows(rows) {
  const truncated = rows.length > REPORT_ROW_LIMIT;
  return {
    rows: truncated ? rows.slice(0, REPORT_ROW_LIMIT) : rows,
    truncated,
    rowLimit: REPORT_ROW_LIMIT,
  };
}

export async function getIncomeReport(tenantId, filters) {
  const [history, total] = await Promise.all([
    transactionsRepository.listHistory(tenantId, { ...filters, type: 'income', limit: FETCH_LIMIT }),
    transactionsRepository.sumByType(tenantId, 'income', filters),
  ]);
  return { ...capRows(history), total };
}

export async function getExpenseReport(tenantId, filters) {
  const [history, total] = await Promise.all([
    transactionsRepository.listHistory(tenantId, { ...filters, type: 'expense', limit: FETCH_LIMIT }),
    transactionsRepository.sumByType(tenantId, 'expense', filters),
  ]);
  return { ...capRows(history), total };
}

export async function getTransactionJournal(tenantId, filters) {
  return capRows(await transactionsRepository.listHistory(tenantId, { ...filters, limit: FETCH_LIMIT }));
}

export async function getContributionsReport(tenantId, filters, { canViewContributors }) {
  // The total is a database aggregate over every matching contribution, not
  // a sum of the rows below it: past the cap the two would disagree, and the
  // total is the figure the report exists to state.
  const [found, total] = await Promise.all([
    contributionsRepository.search(tenantId, { ...filters, limit: FETCH_LIMIT }),
    contributionsRepository.sumSearch(tenantId, filters),
  ]);
  const capped = capRows(found);
  const enriched = await enrichWithContributorInfo(tenantId, capped.rows, canViewContributors);
  return { ...capped, rows: enriched, total };
}

export async function getAccountStatement(tenantId, accountId, { dateFrom, dateTo, financialPeriodId } = {}) {
  const account = await accountsRepository.findById(tenantId, accountId);
  if (!account) throw notFound('Account not found');

  const openingBalance = dateFrom
    ? await transactionsRepository.sumSignedThroughDate(tenantId, dateFrom, { accountId, inclusive: false })
    : '0.00';
  const capped = capRows(
    await transactionsRepository.listHistory(tenantId, {
      accountId,
      dateFrom,
      dateTo,
      financialPeriodId,
      status: 'posted',
      limit: FETCH_LIMIT,
    })
  );
  // Both balances are aggregates over the account's whole history, so they
  // remain the true opening and closing figures even when the movement list
  // between them is capped.
  const closingBalance = await transactionsRepository.sumSigned(tenantId, { accountId, financialPeriodId });
  return { account, openingBalance, ...capped, closingBalance };
}

export async function getFundStatement(tenantId, fundId, { dateFrom, dateTo, financialPeriodId } = {}) {
  const fund = await fundsRepository.findById(tenantId, fundId);
  if (!fund) throw notFound('Fund not found');

  const openingBalance = dateFrom
    ? await transactionsRepository.sumSignedThroughDate(tenantId, dateFrom, { fundId, inclusive: false })
    : '0.00';
  const capped = capRows(
    await transactionsRepository.listHistory(tenantId, {
      fundId,
      dateFrom,
      dateTo,
      financialPeriodId,
      status: 'posted',
      limit: FETCH_LIMIT,
    })
  );
  const closingBalance = await transactionsRepository.sumSigned(tenantId, { fundId, financialPeriodId });
  return { fund, openingBalance, ...capped, closingBalance };
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
  // An explicit limit. Without one this inherited the pledge repository's
  // interactive-list default of 50 rows, so a church with more than fifty
  // pledges got a report showing fifty of them — and totals added up from
  // those fifty, printed as the campaign's total pledged and fulfilled.
  const capped = capRows(await listPledges(tenantId, { ...filters, limit: FETCH_LIMIT }));
  const enriched = await enrichWithContributorInfo(tenantId, capped.rows, canViewContributors);
  // Fulfilment is computed per pledge rather than aggregated in SQL, so
  // unlike the other reports these totals do describe the rows listed. Past
  // the cap that is stated with the report instead of being left to assume.
  const totalPledged = sumMoney(capped.rows.map((p) => p.pledged_amount));
  const totalFulfilled = sumMoney(capped.rows.map((p) => p.fulfilled_amount));
  return {
    ...capped,
    rows: enriched,
    totalPledged,
    totalFulfilled,
    totalRemaining: subtractMoney(totalPledged, totalFulfilled),
  };
}

export async function getFinancialSummaryReport(tenantId, financialPeriodId) {
  return getFinancialSummary(tenantId, financialPeriodId);
}

// TRIAL BALANCE (Ulinganisho wa Hesabu)
//
// The report double-entry exists to produce: every GL account with its
// debit and credit totals, and the assertion that the two columns are
// equal. Reads the journal (chart_of_accounts + journal_lines), never the
// `transactions` subsidiary ledger — a trial balance drawn from single-entry
// cash rows would be a restatement, not a proof.
//
// `isBalanced` is the whole point of the report. If it is ever false the
// books are broken and the number is more useful than a thrown error: an
// auditor needs to SEE the discrepancy and its size, not get a 500.
// Zero-balance rows built from the standard chart-of-accounts template, in
// memory. Used when there is no ledger to read, so the report still renders
// the real account structure instead of an empty sheet — without writing
// anything to the database from a GET.
function baselineAccountsFromTemplate() {
  return CHART_OF_ACCOUNTS_TEMPLATE.map((account) => ({
    code: account.code,
    name: account.name,
    name_sw: account.nameSw,
    account_type: account.accountType,
    normal_balance: NORMAL_BALANCE_BY_TYPE[account.accountType],
    total_debit: '0.00',
    total_credit: '0.00',
  }));
}

export async function getTrialBalanceReport(tenantId, { financialPeriodId } = {}) {
  // THE 500 FIX. On a server where migration 0037 has not been applied,
  // chart_of_accounts does not exist and MySQL raises ER_NO_SUCH_TABLE. A raw
  // driver error carries no HTTP status, so it surfaced as a 500 — and
  // because this query runs before the controller branches on format, the
  // screen, PDF and XLSX exports all failed identically.
  //
  // Only a SCHEMA-MISSING error is absorbed. Any other failure still
  // propagates as an error: returning zeros for a query that genuinely broke
  // would show an auditor "Books are Balanced, 0.00" — a confident, false
  // answer is worse than a visible failure. When the ledger is unavailable
  // the response says so (`available: false`, `isBalanced: null`) rather than
  // claiming the books balance.
  let available = true;
  let accounts = await withSchemaFallback(
    'reports.trial_balance',
    () => chartOfAccountsRepository.trialBalance(tenantId, { financialPeriodId }),
    () => {
      available = false;
      return baselineAccountsFromTemplate();
    }
  );

  // A church that has never posted since the general ledger was introduced
  // has no chart-of-accounts rows yet (they are seeded on first posting).
  // Show the standard structure at zero rather than a blank report — that
  // IS its correct trial balance.
  if (available && accounts.length === 0) accounts = baselineAccountsFromTemplate();

  const rows = accounts.map((account) => {
    const debit = normalizeMoney(String(account.total_debit ?? '0'));
    const credit = normalizeMoney(String(account.total_credit ?? '0'));
    // An account's balance is shown on the side it normally sits, so a
    // reader is not asked to mentally negate half the sheet.
    const net =
      account.normal_balance === 'debit' ? subtractMoney(debit, credit) : subtractMoney(credit, debit);
    return {
      code: account.code,
      name: account.name,
      nameSw: account.name_sw,
      accountType: account.account_type,
      normalBalance: account.normal_balance,
      debit,
      credit,
      balance: net,
    };
  });

  const totals = rows.reduce(
    (acc, row) => ({ debit: addMoney(acc.debit, row.debit), credit: addMoney(acc.credit, row.credit) }),
    { debit: '0.00', credit: '0.00' }
  );

  return {
    rows,
    totals: { code: '', name: 'TOTAL', debit: totals.debit, credit: totals.credit },
    available,
    // null, not true, when the ledger could not be read: zero equals zero,
    // but that is not evidence the books balance.
    isBalanced: available ? compareMoney(totals.debit, totals.credit) === 0 : null,
    difference: subtractMoney(totals.debit, totals.credit),
  };
}

// DASHBOARD INSIGHTS — the cockpit's three aggregate panels in one round trip:
//   collections   posted giving split into tithe (Zaka) / offering (Sadaka) / other
//   departments   posted giving per church department (migration 0038)
//   makato        mobile-money volume and agent/transfer fees (migration 0038)
//
// Each panel degrades independently. `departments` and `makato` depend on
// migration 0038; on a server where it is pending they come back with
// `available: false` instead of taking the whole dashboard down, and the UI
// explains that rather than showing a misleading zero.
export async function getDashboardInsights(tenantId, { dateFrom, dateTo }) {
  const [groupRows, departmentRows, feeRows] = await Promise.all([
    contributionsRepository.sumByReportGroup(tenantId, { dateFrom, dateTo }),
    withSchemaFallback('dashboard.departments', () => contributionsRepository.sumByDepartment(tenantId, { dateFrom, dateTo }), null),
    withSchemaFallback('dashboard.makato', () => contributionsRepository.mobileMoneyFees(tenantId, { dateFrom, dateTo }), null),
  ]);

  const byGroup = Object.fromEntries(groupRows.map((row) => [row.report_group, String(row.total)]));
  const tithe = normalizeMoney(byGroup.tithe ?? '0');
  const offering = normalizeMoney(byGroup.offering ?? '0');
  const other = normalizeMoney(byGroup.other ?? '0');

  const providers = (feeRows ?? []).map((row) => ({
    provider: row.provider,
    transactionCount: Number(row.transaction_count),
    totalSent: normalizeMoney(String(row.total_sent)),
    totalFees: normalizeMoney(String(row.total_fees)),
    postedFees: normalizeMoney(String(row.posted_fees ?? '0')),
  }));
  const totalSent = sumMoney(providers.map((p) => p.totalSent));
  const totalFees = sumMoney(providers.map((p) => p.totalFees));
  // What the ledger holds as posted Makato expense, and what is still only
  // recorded beside the contribution (everything charged before migration
  // 0039). Reported separately: merging them would claim the books contain
  // entries they do not.
  const postedFees = sumMoney(providers.map((p) => p.postedFees));
  const unpostedFees = subtractMoney(totalFees, postedFees);
  const transactionCount = providers.reduce((sum, p) => sum + p.transactionCount, 0);

  // Fee as a share of what was sent, in basis points computed from integer
  // cents so the percentage is exact rather than a float artefact.
  const sentCents = Math.round(Number(totalSent) * 100);
  const feeCents = Math.round(Number(totalFees) * 100);
  const feeRateBasisPoints = sentCents > 0 ? Math.round((feeCents * 10000) / sentCents) : 0;

  return {
    dateFrom,
    dateTo,
    collections: { tithe, offering, other, total: sumMoney([tithe, offering, other]) },
    departments: {
      available: departmentRows !== null,
      rows: (departmentRows ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        total: normalizeMoney(String(row.total)),
        contributionCount: Number(row.contribution_count),
      })),
    },
    makato: {
      available: feeRows !== null,
      totalSent,
      totalFees,
      // Materialised from the ledger: the fee expense transactions linked to
      // these contributions (migration 0039).
      postedFees,
      unpostedFees,
      // What actually reached the church after agents took their cut.
      netReceived: subtractMoney(totalSent, totalFees),
      transactionCount,
      feeRatePercent: (feeRateBasisPoints / 100).toFixed(2),
      averageFee: transactionCount > 0 ? (Math.round(feeCents / transactionCount) / 100).toFixed(2) : '0.00',
      providers,
    },
  };
}

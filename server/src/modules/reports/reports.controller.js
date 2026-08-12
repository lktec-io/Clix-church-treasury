import * as reportsService from './reports.service.js';
import { toCsv, toExcelBuffer, streamPdfReport } from './exporters.js';
import {
  TRANSACTION_COLUMNS,
  CONTRIBUTION_COLUMNS,
  PLEDGE_COLUMNS,
  BUDGET_COLUMNS,
  contributionRowForExport,
  pledgeRowForExport,
} from './reportColumns.js';
import { tenantsRepository } from '../tenants/tenants.repository.js';
import { validationError, forbidden } from '../../errors/AppError.js';

function dateFilters(query) {
  const filters = {};
  if (query.dateFrom) filters.dateFrom = query.dateFrom;
  if (query.dateTo) filters.dateTo = query.dateTo;
  if (query.financialPeriodId) filters.financialPeriodId = Number(query.financialPeriodId);
  if (query.accountId) filters.accountId = Number(query.accountId);
  if (query.fundId) filters.fundId = Number(query.fundId);
  if (query.categoryId) filters.categoryId = Number(query.categoryId);
  if (query.status) filters.status = query.status;
  if (query.paymentMethod) filters.paymentMethod = query.paymentMethod;
  return filters;
}

// Human-readable "filters used" line for the PDF header (docs/MASTER_TODO.md
// Phase 9: exported PDFs must show which filters produced the report).
function describeFilters(filters) {
  const parts = [];
  if (filters.dateFrom) parts.push(`From ${filters.dateFrom}`);
  if (filters.dateTo) parts.push(`To ${filters.dateTo}`);
  if (filters.status) parts.push(`Status: ${filters.status}`);
  return parts.join('   ');
}

async function respond(req, res, { title, columns, rows, exportRows = rows, totals, meta = {}, filterSummary }) {
  const format = req.query.format ?? 'json';
  if (format === 'json') {
    return res.json({ success: true, data: { rows, totals, ...meta } });
  }
  // A user can view a report on-screen with only the report's own .view
  // permission, but exporting it (PDF/Excel/CSV) additionally requires
  // reports.export — "do not allow users to export data they cannot view"
  // is the floor, not the ceiling; export is a distinct, audit-relevant
  // action (docs/MASTER_TODO.md Phase 9).
  if (!req.permissions?.includes('reports.export')) {
    throw forbidden('Missing permission: reports.export');
  }
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="report.csv"');
    return res.send(toCsv(exportRows, columns));
  }
  if (format === 'xlsx') {
    const buffer = await toExcelBuffer(exportRows, columns, title);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="report.xlsx"');
    return res.send(buffer);
  }
  if (format === 'pdf') {
    const tenant = await tenantsRepository.findById(req.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="report.pdf"');
    return streamPdfReport({ tenant, title, filterSummary, columns, rows: exportRows, totals }, res);
  }
  throw validationError('Invalid format', { format: 'must be one of: json, csv, xlsx, pdf' });
}

export async function income(req, res, next) {
  try {
    const filters = dateFilters(req.query);
    const { rows, total } = await reportsService.getIncomeReport(req.tenantId, filters);
    await respond(req, res, {
      title: 'Income Report',
      columns: TRANSACTION_COLUMNS,
      rows,
      totals: { amount: total },
      filterSummary: describeFilters(filters),
    });
  } catch (err) {
    next(err);
  }
}

export async function expense(req, res, next) {
  try {
    const filters = dateFilters(req.query);
    const { rows, total } = await reportsService.getExpenseReport(req.tenantId, filters);
    await respond(req, res, {
      title: 'Expense Report',
      columns: TRANSACTION_COLUMNS,
      rows,
      totals: { amount: total },
      filterSummary: describeFilters(filters),
    });
  } catch (err) {
    next(err);
  }
}

export async function transactionJournal(req, res, next) {
  try {
    const filters = dateFilters(req.query);
    const { rows } = await reportsService.getTransactionJournal(req.tenantId, filters);
    await respond(req, res, { title: 'Transaction Journal', columns: TRANSACTION_COLUMNS, rows, filterSummary: describeFilters(filters) });
  } catch (err) {
    next(err);
  }
}

export async function contributions(req, res, next) {
  try {
    const canViewContributors = req.permissions?.includes('contributors.view') ?? false;
    const filters = dateFilters(req.query);
    const { rows, total } = await reportsService.getContributionsReport(req.tenantId, filters, {
      canViewContributors,
    });
    await respond(req, res, {
      title: 'Contributions Report',
      columns: CONTRIBUTION_COLUMNS,
      rows,
      exportRows: rows.map(contributionRowForExport),
      totals: { amount: total },
      filterSummary: describeFilters(filters),
    });
  } catch (err) {
    next(err);
  }
}

export async function accountStatement(req, res, next) {
  try {
    const filters = dateFilters(req.query);
    const data = await reportsService.getAccountStatement(req.tenantId, req.params.accountId, filters);
    await respond(req, res, {
      title: `Account Statement — ${data.account.name}`,
      columns: TRANSACTION_COLUMNS,
      rows: data.rows,
      totals: { amount: data.closingBalance },
      meta: { account: data.account, openingBalance: data.openingBalance, closingBalance: data.closingBalance },
      filterSummary: `Account: ${data.account.name}   Opening balance: ${data.openingBalance}   ${describeFilters(filters)}`,
    });
  } catch (err) {
    next(err);
  }
}

export async function fundStatement(req, res, next) {
  try {
    const filters = dateFilters(req.query);
    const data = await reportsService.getFundStatement(req.tenantId, req.params.fundId, filters);
    await respond(req, res, {
      title: `Fund Statement — ${data.fund.name}`,
      columns: TRANSACTION_COLUMNS,
      rows: data.rows,
      totals: { amount: data.closingBalance },
      meta: { fund: data.fund, openingBalance: data.openingBalance, closingBalance: data.closingBalance },
      filterSummary: `Fund: ${data.fund.name}   Opening balance: ${data.openingBalance}   ${describeFilters(filters)}`,
    });
  } catch (err) {
    next(err);
  }
}

export async function budgetVsActual(req, res, next) {
  try {
    const { rows, totals } = await reportsService.getBudgetVsActualReport(req.tenantId, Number(req.query.financialPeriodId));
    await respond(req, res, { title: 'Budget vs Actual', columns: BUDGET_COLUMNS, rows, totals });
  } catch (err) {
    next(err);
  }
}

export async function pledgeReport(req, res, next) {
  try {
    const canViewContributors = req.permissions?.includes('contributors.view') ?? false;
    const filters = dateFilters(req.query);
    const { rows, totalPledged, totalFulfilled, totalRemaining } = await reportsService.getPledgeReport(
      req.tenantId,
      filters,
      { canViewContributors }
    );
    await respond(req, res, {
      title: 'Pledge Report',
      columns: PLEDGE_COLUMNS,
      rows,
      exportRows: rows.map(pledgeRowForExport),
      totals: { pledged_amount: totalPledged, fulfilled_amount: totalFulfilled, remaining_amount: totalRemaining },
      filterSummary: describeFilters(filters),
    });
  } catch (err) {
    next(err);
  }
}

export async function financialSummary(req, res, next) {
  try {
    const data = await reportsService.getFinancialSummaryReport(req.tenantId, Number(req.query.financialPeriodId));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

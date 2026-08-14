import { validationError } from '../../errors/AppError.js';
import { contributionsRepository } from './contributions.repository.js';
import { categoriesRepository } from '../categories/categories.repository.js';
import { sumMoney } from '../financial/money.js';

function monthBounds(year, month) {
  const pad = (n) => String(n).padStart(2, '0');
  const dateFrom = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate(); // month is 1-12; Date's 0th day of that (0-indexed) month = last day of the target month
  const dateTo = `${year}-${pad(month)}-${pad(lastDay)}`;
  return { dateFrom, dateTo };
}

export function validateYearMonth(yearRaw, monthRaw) {
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw validationError('Invalid payload', { year: 'must be a valid year' });
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw validationError('Invalid payload', { month: 'must be between 1 and 12' });
  }
  return { year, month };
}

// Buckets one contributor's contributions for one calendar month into
// Zaka/Sadaka/Matoleo-Mengine (tithe/offering/other) by each contribution's
// category.report_group (migration 0029) — not by category name, so it
// stays correct regardless of what a tenant happens to have named its
// categories. In-JS summation over an already-fetched, small row set,
// matching the same style financialSummary.service.js already uses rather
// than introducing the codebase's first SQL GROUP BY for one report.
export async function getMonthlyStatement(tenantId, contributorId, year, month) {
  const { dateFrom, dateTo } = monthBounds(year, month);
  const [contributions, categories] = await Promise.all([
    contributionsRepository.search(tenantId, { contributorId, dateFrom, dateTo, limit: 1000 }),
    categoriesRepository.findAllByTenant(tenantId),
  ]);

  const reportGroupByCategoryId = new Map(categories.map((c) => [c.id, c.report_group]));
  const posted = contributions.filter((c) => c.status === 'posted');

  const byGroup = { tithe: [], offering: [], other: [] };
  for (const contribution of posted) {
    const group = reportGroupByCategoryId.get(contribution.category_id) ?? 'other';
    (byGroup[group] ?? byGroup.other).push(contribution.amount);
  }

  const tithe = sumMoney(byGroup.tithe);
  const offering = sumMoney(byGroup.offering);
  const other = sumMoney(byGroup.other);
  const total = sumMoney([tithe, offering, other]);

  return { contributorId, year, month, tithe, offering, other, total, contributions: posted };
}

// Lighter-weight sibling of getMonthlyStatement for the member dashboard's
// "this year" figure — one total, no per-category breakdown, so it doesn't
// need the report_group bucketing pass.
export async function getYearlyTotal(tenantId, contributorId, year) {
  const dateFrom = `${year}-01-01`;
  const dateTo = `${year}-12-31`;
  const contributions = await contributionsRepository.search(tenantId, { contributorId, dateFrom, dateTo, limit: 1000 });
  const total = sumMoney(contributions.filter((c) => c.status === 'posted').map((c) => c.amount));
  return { contributorId, year, total };
}

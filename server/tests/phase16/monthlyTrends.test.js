// getMonthlyTrends assembles the dashboard's trend timeline. The repository
// call is stubbed so these run without a database — what is under test is
// the window construction, the gap filling, and the forecast arithmetic,
// none of which involve SQL.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transactionsRepository } from '../../src/modules/financial/transactions.repository.js';
import { getMonthlyTrends } from '../../src/modules/reports/reports.service.js';

const TENANT = 1;

function stub({ income = [], expense = [] }) {
  return vi.spyOn(transactionsRepository, 'monthlyTotalsByType').mockImplementation((_t, type) =>
    Promise.resolve(type === 'income' ? income : expense)
  );
}

// Pinned clock — a rolling window is otherwise untestable, and a test that
// silently changes shape at a month boundary is worse than no test.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-15T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('getMonthlyTrends window', () => {
  it('returns exactly `months` buckets ending with the current month', async () => {
    stub({});
    const { series } = await getMonthlyTrends(TENANT, { months: 12 });
    expect(series).toHaveLength(12);
    expect(series[0].period).toBe('2025-10');
    expect(series[11].period).toBe('2026-09');
  });

  it('fills months with no activity as 0.00 rather than omitting them', async () => {
    stub({ income: [{ period: '2026-09', total: '500.00' }] });
    const { series } = await getMonthlyTrends(TENANT, { months: 3 });
    expect(series.map((p) => p.period)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(series.map((p) => p.income)).toEqual(['0.00', '0.00', '500.00']);
  });

  it('carries income and expense independently per bucket', async () => {
    stub({
      income: [{ period: '2026-09', total: '900.00' }],
      expense: [{ period: '2026-08', total: '120.50' }],
    });
    const { series } = await getMonthlyTrends(TENANT, { months: 2 });
    expect(series[0]).toMatchObject({ period: '2026-08', income: '0.00', expense: '120.50' });
    expect(series[1]).toMatchObject({ period: '2026-09', income: '900.00', expense: '0.00' });
  });

  it('reports the query window it used', async () => {
    stub({});
    const { dateFrom, dateTo } = await getMonthlyTrends(TENANT, { months: 12 });
    expect(dateFrom).toBe('2025-10-01');
    expect(dateTo).toBe('2026-09-30');
  });
});

describe('forecast', () => {
  it('averages the last three months that had activity', async () => {
    stub({
      income: [
        { period: '2026-07', total: '300.00' },
        { period: '2026-08', total: '600.00' },
        { period: '2026-09', total: '900.00' },
      ],
    });
    const { forecast } = await getMonthlyTrends(TENANT, { months: 12 });
    expect(forecast).toMatchObject({ period: '2026-10', amount: '600.00', basisMonths: 3 });
  });

  // Zero months are skipped, not averaged in. Including them would drag a
  // new tenant's projection toward zero purely because the system was not
  // in use yet — an artefact of adoption, not of giving.
  it('ignores months with no income when choosing the basis', async () => {
    stub({
      income: [
        { period: '2026-08', total: '400.00' },
        { period: '2026-09', total: '600.00' },
      ],
    });
    const { forecast } = await getMonthlyTrends(TENANT, { months: 12 });
    expect(forecast).toMatchObject({ amount: '500.00', basisMonths: 2 });
  });

  it('is null when there is no income at all — nothing to project from', async () => {
    stub({});
    const { forecast } = await getMonthlyTrends(TENANT, { months: 12 });
    expect(forecast).toBeNull();
  });

  // The projection is rendered next to real money, so it must be a clean
  // 2dp money string — never a float artefact like 333.33333333333337.
  it('rounds to whole cents rather than emitting a float artefact', async () => {
    stub({
      income: [
        { period: '2026-07', total: '100.00' },
        { period: '2026-08', total: '100.00' },
        { period: '2026-09', total: '100.01' },
      ],
    });
    const { forecast } = await getMonthlyTrends(TENANT, { months: 12 });
    expect(forecast.amount).toMatch(/^\d+\.\d{2}$/);
    expect(forecast.amount).toBe('100.00');
  });

  it('projects the month AFTER the window, never inside it', async () => {
    stub({ income: [{ period: '2026-09', total: '100.00' }] });
    const { series, forecast } = await getMonthlyTrends(TENANT, { months: 12 });
    expect(series.some((p) => p.period === forecast.period)).toBe(false);
    expect(forecast.period).toBe('2026-10');
  });

  it('rolls the projected month into the next year at a December boundary', async () => {
    vi.setSystemTime(new Date('2026-12-10T00:00:00Z'));
    stub({ income: [{ period: '2026-12', total: '100.00' }] });
    const { forecast } = await getMonthlyTrends(TENANT, { months: 12 });
    expect(forecast).toMatchObject({ period: '2027-01', year: 2027, month: 1 });
  });
});

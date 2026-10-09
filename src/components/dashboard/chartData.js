// Pure helpers that decide what the dashboard charts draw. Kept apart from
// DashboardCharts.jsx so that file exports only components.
import { parseServerDate } from '../../utils/format.js';

// True when every month in the window is zero — the "no activity yet" case,
// which gets an empty state rather than a flat row of zero-height bars.
export function trendIsEmpty(series) {
  return series.every((p) => !(Number(p.income) > 0) && !(Number(p.expense) > 0));
}

// Only income and expense postings. Transfers move money between the
// church's own accounts (they would plot as both an in AND an out), and
// reversals are corrections — the same rule monthlyTotalsByType applies.
export function activityPoints(rows) {
  return rows
    .filter((row) => row.type === 'income' || row.type === 'expense')
    .map((row) => {
      const stamp = row.posted_at ?? row.created_at;
      return { row, stamp, time: parseServerDate(stamp).getTime(), amount: Number(row.amount) || 0 };
    })
    .filter((point) => Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time);
}

export function collectionsAreEmpty(collections) {
  return !collections || !(Number(collections.total) > 0);
}

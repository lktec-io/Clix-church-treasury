// Installment schedule for a pledge paid daily, weekly or monthly.
// Pure (no I/O) so it is unit-testable, and money is handled in integer
// CENTS throughout — never floats (docs/FINANCIAL_ARCHITECTURE.md).

export const PLEDGE_FREQUENCIES = ['once', 'daily', 'weekly', 'monthly'];

const DAY_MS = 86_400_000;

// YYYY-MM-DD → UTC midnight. Parsed by hand, not `new Date(str)`, so the
// result never shifts a day depending on the server's timezone.
function parseDate(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toCents(money) {
  const [whole, frac = ''] = String(money ?? '0').split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

function fromCents(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * Number of installment periods from `startMs` to `endMs`, both inclusive.
 * A pledge from 1 Sep to 1 Sep is one period, not zero.
 */
function countPeriods(frequency, startMs, endMs) {
  if (endMs < startMs) return 0;
  if (frequency === 'daily') return Math.floor((endMs - startMs) / DAY_MS) + 1;
  if (frequency === 'weekly') return Math.floor((endMs - startMs) / (7 * DAY_MS)) + 1;
  if (frequency === 'monthly') {
    const s = new Date(startMs);
    const e = new Date(endMs);
    return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + 1;
  }
  return 1;
}

/**
 * Computes the schedule for a pledge.
 *
 * Returns null when there is nothing to schedule: a one-off pledge, or a
 * recurring pledge with no target date (the number of installments is
 * unknowable without an end).
 *
 *   installment      the amount due each period
 *   periods          total installments over the pledge
 *   periodsElapsed   installments that have fallen due as of `today`
 *   expectedToDate   what should have been paid by now
 *   arrears          how far behind that the member is (never negative)
 *
 * The installment is rounded UP to the cent, so paying every installment
 * always covers the full pledge; the final one simply finishes early.
 */
export function computePledgeSchedule({ pledgedAmount, fulfilledAmount, pledgeDate, targetDate, frequency }, today = new Date()) {
  if (!frequency || frequency === 'once') return null;
  const start = parseDate(pledgeDate);
  const end = parseDate(targetDate);
  if (start === null || end === null) return null;

  const periods = countPeriods(frequency, start, end);
  if (periods <= 0) return null;

  const pledgedCents = toCents(pledgedAmount);
  const fulfilledCents = toCents(fulfilledAmount);
  const installmentCents = Math.ceil(pledgedCents / periods);

  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const periodsElapsed = todayMs < start ? 0 : countPeriods(frequency, start, Math.min(todayMs, end));

  const expectedCents = Math.min(pledgedCents, installmentCents * periodsElapsed);
  const arrearsCents = Math.max(0, expectedCents - fulfilledCents);

  return {
    frequency,
    periods,
    periodsElapsed,
    installment: fromCents(installmentCents),
    expectedToDate: fromCents(expectedCents),
    arrears: fromCents(arrearsCents),
  };
}

// Money is never handled as a JS number in this module — only as a decimal
// string, matching the DECIMAL(14,2) column type and mysql2's
// `decimalNumbers: false` config (src/config/db.js). Aggregates (SUM) are
// computed by MySQL itself over the DECIMAL column and passed through
// unchanged, so no floating-point arithmetic ever touches a money value
// anywhere in this codebase (docs/FINANCIAL_ARCHITECTURE.md).
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;

export function isPositiveMoneyString(value) {
  return typeof value === 'string' && MONEY_RE.test(value) && Number(value) > 0;
}

export function normalizeMoney(value) {
  const [whole, frac = ''] = value.split('.');
  return `${whole}.${frac.padEnd(2, '0').slice(0, 2)}`;
}

function toCents(value) {
  const [whole, frac = ''] = String(value).split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  const cents = Math.abs(Number(whole)) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
  return sign * cents;
}

function fromCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// Integer-cents arithmetic for the rare case display code needs to subtract
// two money values (e.g. pledge remaining = pledged - fulfilled) — even
// though this is display-only, not a ledger posting, the codebase's
// no-floating-point-on-money rule applies uniformly rather than carving out
// an exception for "just display" arithmetic (docs/FINANCIAL_ARCHITECTURE.md).
export function subtractMoney(a, b) {
  return fromCents(toCents(a) - toCents(b));
}

export function addMoney(a, b) {
  return fromCents(toCents(a) + toCents(b));
}

// Sums a JS array of money strings at the integer-cents level — for the
// handful of report totals that aggregate an already-fetched row list
// (rather than a fresh SQL SUM) and would otherwise be tempted to reduce
// with `+` over `Number(...)`, reintroducing exactly the floating-point
// risk this module exists to rule out.
export function sumMoney(values) {
  return fromCents(values.reduce((cents, v) => cents + toCents(v), 0));
}

// -1 / 0 / 1, exactly like a sort comparator — for any "would this exceed
// that" check the codebase needs without going through a JS float (e.g. an
// overpayment guard). Comparing at the integer-cents level means there is no
// binary-fraction rounding edge case to guard against with an epsilon.
export function compareMoney(a, b) {
  const diff = toCents(a) - toCents(b);
  return diff === 0 ? 0 : diff > 0 ? 1 : -1;
}

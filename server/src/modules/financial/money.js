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

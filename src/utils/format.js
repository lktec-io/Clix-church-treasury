// Display-only formatting — never used for calculation. Money arrives from
// the API as a decimal string (docs/FINANCIAL_ARCHITECTURE.md §1) and stays
// a string here too; this only inserts thousands separators, it never
// parses through a JS float for arithmetic.
// Accepts a decimal string (the normal case, straight from the API), a
// plain number (display-side aggregates — the dashboard's fund totals and
// the donut's per-segment values are produced by reduce/arithmetic), or
// null/undefined. It must never throw: this runs inside render, so an
// exception here unmounts the React tree and blanks the whole page. That
// is not hypothetical — passing a Number here was exactly what blanked the
// dashboard after login.
//
// NOTE on the coercion: `?? ''` and NOT `|| ''`. A legitimate zero is
// falsy, so `amount || ''` would turn the number 0 and the string "0.00"
// into an em dash — silently hiding a real, meaningful balance of zero.
export function formatMoney(amount) {
  if (amount === null || amount === undefined) return '—';

  let amountString;
  if (typeof amount === 'string') {
    amountString = amount;
  } else if (typeof amount === 'number') {
    // NaN/Infinity have no sensible money rendering.
    if (!Number.isFinite(amount)) return '—';
    amountString = amount.toFixed(2);
  } else if (typeof amount === 'bigint') {
    amountString = `${amount}.00`;
  } else {
    // An object, array, boolean or anything else is a caller bug, not a
    // value to render. Degrade to the same placeholder as null instead of
    // crashing the page around it.
    return '—';
  }

  amountString = amountString.trim();
  if (amountString === '') return '—';

  const negative = amountString.startsWith('-');
  const [whole, frac = '00'] = (negative ? amountString.slice(1) : amountString).split('.');
  const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${withSeparators}.${frac}`;
}

// The backend's money validator (server/src/modules/financial/money.js)
// requires a bare "1234.56"-shaped string with no thousands separators —
// but every amount field in this app is a plain text input with no input
// mask, and typing "10,000" is completely ordinary for a financial
// figure. Every amount-collecting form (Contributions, Expenses,
// Transfers, Pledges, Budgets) runs the value through this before
// sending it to the API, so that entirely normal input is never rejected.
export function sanitizeAmountInput(value) {
  return String(value ?? '').replace(/[,\s]/g, '');
}

// TZS is this product's one and only base currency default
// (tenants.base_currency, docs/PROJECT_ARCHITECTURE.md) — no per-tenant
// currency is fetched/displayed elsewhere in the frontend today, so this
// is a fixed label, not a computed/fabricated value.
export function formatCurrency(amountString) {
  if (amountString === null || amountString === undefined) return '—';
  return `TZS ${formatMoney(amountString)}`;
}

// Same integer-cents approach as the backend's money.js#sumMoney — needed
// here only for display-side aggregation (e.g. grouping a member's
// contributions by month on MemberHistoryPage.jsx); the source of truth
// for every total shown elsewhere in the app is still the backend's own
// calculation, never recomputed from scratch on the frontend.
export function sumMoneyStrings(values) {
  const toCents = (v) => {
    if (v === null || v === undefined) return 0;
    // String(v) first, so `whole` is always a string and .startsWith is
    // always callable — a number or bigint input is safe here.
    const [whole, frac = ''] = String(v).split('.');
    const sign = whole.startsWith('-') ? -1 : 1;
    const wholeCents = Math.abs(Number(whole));
    const fracCents = Number(frac.padEnd(2, '0').slice(0, 2));
    // A non-numeric entry (empty string, "abc") would make Number() NaN and
    // poison the entire sum, turning a whole page of totals into "NaN".
    if (!Number.isFinite(wholeCents) || !Number.isFinite(fracCents)) return 0;
    return sign * (wholeCents * 100 + fracCents);
  };
  const cents = (Array.isArray(values) ? values : []).reduce((sum, v) => sum + toCents(v), 0);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

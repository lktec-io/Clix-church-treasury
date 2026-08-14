// Display-only formatting — never used for calculation. Money arrives from
// the API as a decimal string (docs/FINANCIAL_ARCHITECTURE.md §1) and stays
// a string here too; this only inserts thousands separators, it never
// parses through a JS float for arithmetic.
export function formatMoney(amountString) {
  if (amountString === null || amountString === undefined) return '—';
  const negative = amountString.startsWith('-');
  const [whole, frac = '00'] = (negative ? amountString.slice(1) : amountString).split('.');
  const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${withSeparators}.${frac}`;
}

// Same integer-cents approach as the backend's money.js#sumMoney — needed
// here only for display-side aggregation (e.g. grouping a member's
// contributions by month on MemberHistoryPage.jsx); the source of truth
// for every total shown elsewhere in the app is still the backend's own
// calculation, never recomputed from scratch on the frontend.
export function sumMoneyStrings(values) {
  const toCents = (v) => {
    const [whole, frac = ''] = String(v).split('.');
    const sign = whole.startsWith('-') ? -1 : 1;
    return sign * (Math.abs(Number(whole)) * 100 + Number(frac.padEnd(2, '0').slice(0, 2)));
  };
  const cents = values.reduce((sum, v) => sum + toCents(v), 0);
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

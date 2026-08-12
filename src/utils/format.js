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

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

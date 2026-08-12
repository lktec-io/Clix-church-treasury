// Display-only formatting (PDF/Excel/CSV renderers, receipts) — never used
// for calculation. Takes the same decimal-string values every financial
// query already returns (money.js) and only inserts thousands separators;
// never parses through a JS float. Mirrors src/utils/format.js on the
// frontend, kept separate since the two apps don't share a module boundary.
export function formatMoney(amountString) {
  if (amountString === null || amountString === undefined) return '0.00';
  const negative = amountString.startsWith('-');
  const [whole, frac = '00'] = (negative ? amountString.slice(1) : amountString).split('.');
  const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${withSeparators}.${frac}`;
}

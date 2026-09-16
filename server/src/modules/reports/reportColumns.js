// Column definitions per report — shared between the JSON response shape
// (frontend renders its own table) and the CSV/Excel/PDF exporters, so a
// column never has to be defined twice.
export const TRANSACTION_COLUMNS = [
  { key: 'transaction_number', header: 'Transaction No.' },
  { key: 'posted_at', header: 'Date' },
  { key: 'type', header: 'Type' },
  { key: 'direction', header: 'Direction' },
  { key: 'amount', header: 'Amount' },
  { key: 'payment_method', header: 'Method' },
  { key: 'description', header: 'Description' },
];

export const CONTRIBUTION_COLUMNS = [
  { key: 'contribution_date', header: 'Date' },
  { key: 'contributor_name', header: 'Contributor' },
  { key: 'amount', header: 'Amount' },
  { key: 'payment_method', header: 'Method' },
  { key: 'status', header: 'Status' },
];

export const PLEDGE_COLUMNS = [
  { key: 'pledge_number', header: 'Pledge No.' },
  { key: 'contributor_name', header: 'Contributor' },
  { key: 'pledged_amount', header: 'Pledged' },
  { key: 'fulfilled_amount', header: 'Paid' },
  { key: 'remaining_amount', header: 'Remaining' },
  { key: 'status', header: 'Status' },
];

export const BUDGET_COLUMNS = [
  { key: 'type', header: 'Type' },
  { key: 'budget_amount', header: 'Budget' },
  { key: 'actual_amount', header: 'Actual' },
  { key: 'variance', header: 'Variance' },
];

// Trial balance. Debit/Credit right-align on the decimal in the PDF, which
// is the whole readability point of the report.
//
// `width` is a CHARACTER width: toExcelBuffer hands it straight to ExcelJS.
// These previously held proportional weights (1, 3, 1.6 …) intended for
// layout, which ExcelJS read literally — the exported spreadsheet had columns
// one to three characters wide and was unreadable. The PDF exporter divides
// its width evenly and ignores this value, so it only ever mattered to Excel.
export const TRIAL_BALANCE_COLUMNS = [
  { key: 'code', header: 'Code', width: 10 },
  { key: 'name', header: 'Account', width: 38 },
  { key: 'accountType', header: 'Type', width: 14 },
  { key: 'debit', header: 'Debit', width: 18, align: 'right' },
  { key: 'credit', header: 'Credit', width: 18, align: 'right' },
];

export function contributionRowForExport(row) {
  return { ...row, contributor_name: row.contributor?.full_name ?? '' };
}

export function pledgeRowForExport(row) {
  return { ...row, contributor_name: row.contributor?.full_name ?? '' };
}

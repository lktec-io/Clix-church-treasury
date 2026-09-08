// Standard chart of accounts seeded for every new tenant.
//
// Deliberately small. A congregation's treasurer is not a chartered
// accountant, and a 200-line corporate COA would be abandoned on day one —
// this is the minimum that produces a defensible trial balance, with room
// for a church to add its own accounts on top.
//
// `systemRole` marks the accounts the posting engine resolves BY ROLE
// (journal.service.js) rather than by name or code, so a church may rename
// or recode any of them without breaking posting.
//
// Coding follows the conventional blocks: 1xxx asset, 2xxx liability,
// 3xxx equity/funds, 4xxx revenue, 5xxx expense.
export const CHART_OF_ACCOUNTS_TEMPLATE = [
  // --- Assets ---
  { code: '1000', name: 'Cash and Bank', nameSw: 'Fedha na Benki', accountType: 'asset', systemRole: 'cash' },
  { code: '1010', name: 'Petty Cash', nameSw: 'Fedha Taslimu Ndogo', accountType: 'asset', systemRole: null },
  // Both legs of a transfer post against this. It nets to exactly zero once
  // the pair is complete, which is also a cheap integrity check: a non-zero
  // transfer-clearing balance means a half-posted transfer.
  {
    code: '1900',
    name: 'Inter-Account Transfer Clearing',
    nameSw: 'Uhamisho kati ya Akaunti',
    accountType: 'asset',
    systemRole: 'transfer_clearing',
  },

  // --- Liabilities ---
  // The accrued obligation to the Conference/Diocese. Credited as tithe is
  // received, debited as it is remitted; the balance IS the outstanding
  // higher-body liability (remittance.service.js).
  {
    code: '2100',
    name: 'Higher-Body Remittance Payable',
    nameSw: 'Deni la Kutuma Ngazi ya Juu',
    accountType: 'liability',
    systemRole: 'remittance_payable',
  },

  // --- Equity / Fund balances ---
  { code: '3000', name: 'General Fund Balance', nameSw: 'Salio la Mfuko Mkuu', accountType: 'equity', systemRole: 'fund_balance' },
  {
    code: '3900',
    name: 'Prior-Period Adjustments',
    nameSw: 'Marekebisho ya Vipindi Vilivyopita',
    accountType: 'equity',
    systemRole: 'adjustment',
  },

  // --- Revenue ---
  {
    code: '4000',
    name: 'Contributions Revenue',
    nameSw: 'Mapato ya Michango',
    accountType: 'revenue',
    systemRole: 'contribution_revenue',
  },
  { code: '4100', name: 'Tithe (Zaka)', nameSw: 'Zaka', accountType: 'revenue', systemRole: null },
  { code: '4200', name: 'Offerings (Sadaka)', nameSw: 'Sadaka', accountType: 'revenue', systemRole: null },
  { code: '4900', name: 'Other Income', nameSw: 'Mapato Mengineyo', accountType: 'revenue', systemRole: null },

  // --- Expenses ---
  { code: '5000', name: 'General Expenses', nameSw: 'Matumizi ya Jumla', accountType: 'expense', systemRole: 'general_expense' },
  { code: '5100', name: 'Utilities', nameSw: 'Huduma (Umeme/Maji)', accountType: 'expense', systemRole: null },
  { code: '5200', name: 'Building and Maintenance', nameSw: 'Ujenzi na Matengenezo', accountType: 'expense', systemRole: null },
  {
    code: '5900',
    name: 'Higher-Body Remittance',
    nameSw: 'Kutuma Ngazi ya Juu',
    accountType: 'expense',
    systemRole: 'remittance_expense',
  },
];

// Which side increases the account. Derived once here rather than at every
// posting site, and stored on the row so a report never re-derives it.
export const NORMAL_BALANCE_BY_TYPE = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
};

// Small, statement-specific label set for server-rendered PDF text —
// mirrors receipts/receiptLabels.js's pattern exactly (separate from the
// frontend's src/i18n dictionaries).
const LABELS = {
  en: {
    statement: 'Giving Statement',
    period: 'Period',
    member: 'Member',
    memberNumber: 'Member No.',
    tithe: 'Tithe',
    offering: 'Offering',
    other: 'Other',
    grandTotal: 'Grand Total',
    date: 'Date',
    amount: 'Amount',
    category: 'Category',
    generatedOn: 'Generated on',
    noContributions: 'No contributions recorded for this period.',
  },
  sw: {
    statement: 'Taarifa ya Matoleo',
    period: 'Kipindi',
    member: 'Mshiriki',
    memberNumber: 'Namba ya Uchangiaji',
    tithe: 'Zaka',
    offering: 'Sadaka',
    other: 'Matoleo Mengine',
    grandTotal: 'Jumla Kuu',
    date: 'Tarehe',
    amount: 'Kiasi',
    category: 'Aina',
    generatedOn: 'Imetengenezwa tarehe',
    noContributions: 'Hakuna michango iliyorekodiwa kwa kipindi hiki.',
  },
};

export function statementLabels(locale) {
  return LABELS[locale] ?? LABELS.en;
}

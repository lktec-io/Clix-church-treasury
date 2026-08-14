// Small, receipt-specific label set for server-rendered PDF text — separate
// from the frontend's src/i18n dictionaries (a different, much larger
// vocabulary) rather than reaching across the frontend/backend boundary to
// share files between two independently deployable apps.
const LABELS = {
  en: {
    receipt: 'Receipt',
    receiptNumber: 'Receipt No.',
    date: 'Date',
    receivedFrom: 'Received From',
    anonymous: 'Anonymous / Not recorded',
    amount: 'Amount',
    fund: 'Fund',
    category: 'Category',
    paymentMethod: 'Payment Method',
    account: 'Account',
    reference: 'Reference',
    description: 'Description',
    recordedBy: 'Recorded By',
    transactionNumber: 'Transaction No.',
    generatedOn: 'Generated on',
    thankYou: 'Thank you for your contribution.',
    breakdown: 'Breakdown',
  },
  sw: {
    receipt: 'Stakabadhi',
    receiptNumber: 'Namba ya Stakabadhi',
    date: 'Tarehe',
    receivedFrom: 'Imepokelewa Kutoka',
    anonymous: 'Haijulikani',
    amount: 'Kiasi',
    fund: 'Mfuko',
    category: 'Aina',
    paymentMethod: 'Njia ya Malipo',
    account: 'Akaunti',
    reference: 'Kumbukumbu',
    description: 'Maelezo',
    recordedBy: 'Imeandikwa na',
    transactionNumber: 'Namba ya Muamala',
    generatedOn: 'Imetengenezwa tarehe',
    thankYou: 'Asante kwa mchango wako.',
    breakdown: 'Mchanganuo',
  },
};

export function receiptLabels(locale) {
  return LABELS[locale] ?? LABELS.en;
}

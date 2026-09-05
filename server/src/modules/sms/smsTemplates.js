// Bilingual (en/sw) SMS body templates, keyed the same way sms_log.template_key
// is stored. Mirrors receiptLabels.js's "small hand-rolled dictionary, no
// templating dependency" approach — `render()` below is the entire
// interpolation engine (`{{key}}` substitution), matching the codebase's
// existing philosophy of not reaching for a package for a few lines of logic
// (see exporters.js's hand-rolled CSV escaping).
//
// Placeholders available per template are documented inline. A placeholder
// with no matching key in `params` is replaced with an empty string rather
// than left as literal `{{...}}` text, since this text is sent to a real
// person's phone.
const TEMPLATES = {
  member_registration: {
    en: '{{churchName}}\nWelcome {{memberName}}.\nYour Giving Number is {{memberNumber}}.\nYour access PIN is: {{pin}}\nPlease change your PIN after logging in.\nTrack your giving: {{portalUrl}}',
    sw: '{{churchName}}\nKaribu {{memberName}}.\nNamba yako ya Uchangiaji ni {{memberNumber}}.\nNenosiri la kuingia ni: {{pin}}\nTafadhali badilisha nenosiri baada ya kuingia.\nFuatilia michango yako: {{portalUrl}}',
  },
  // {{currency}} is a SEPARATE placeholder from {{amount}} on purpose. The
  // currency code is not baked into the template text because base_currency
  // is a per-tenant column (tenants.base_currency, NOT NULL DEFAULT 'TZS') —
  // hardcoding "TZS" here would silently mislabel money for any tenant ever
  // configured otherwise. For every Tanzanian church this renders exactly
  // "TZS 50,000.00", which is the requested wording.
  //
  // The matching rule for callers: {{amount}} and the statement figures must
  // be passed BARE (formatMoney output only, no currency prefix), or the
  // rendered text reads "TZS TZS 50,000.00".
  contribution_confirmation: {
    en: '{{churchName}}\nThank you {{memberName}} for your contribution of {{currency}} {{amount}} on {{date}}.\nReference: {{reference}}\nGod bless you.',
    sw: '{{churchName}}\nTunakushukuru {{memberName}} kwa mchango wako wa {{currency}} {{amount}} tarehe {{date}}.\nKumbukumbu: {{reference}}\nMungu akubariki sana.',
  },
  // {{lines}} is a PRE-RENDERED block, not a scalar — build it with
  // formatSmsLineItems() below and pass the result. It expands to one
  // "- <Fund>: <CUR> <amount>" row per distinct giving purpose the member
  // actually recorded that month (Zaka, Sadaka ya Kambi, Mfuko wa Ujenzi,
  // Idara ya Watoto, …), replacing the previous fixed Zaka/Sadaka/Zinginezo
  // triplet — which collapsed every designated fund into one anonymous
  // "Zinginezo" figure and so could not tell a member what their building-fund
  // gift was.
  //
  // The currency prefix is baked into each rendered line by
  // formatSmsLineItems (it takes `currency` itself), so unlike {{total}}
  // there is no {{currency}} in front of {{lines}} here.
  monthly_statement: {
    en: '{{churchName}}\n{{month}} Giving Statement for {{memberName}}.\n{{lines}}\nGrand Total: {{currency}} {{total}}\nGod bless you.',
    sw: '{{churchName}}\nRipoti ya Utoaji ya {{month}} kwa {{memberName}}.\n{{lines}}\nJumla Kuu: {{currency}} {{total}}\nMungu akubariki sana.',
  },
};

// Label used to roll up the tail of a very long breakdown. A member who gave
// to fifteen funds in one month would otherwise get a six-segment SMS, which
// is a real per-message cost to the church and is truncated outright by some
// handsets. The rolled-up rows are never hidden — they are summed into one
// visible line, and the full detail is always in the PDF statement.
const OVERFLOW_LABEL = { en: 'Other funds', sw: 'Mifuko mingine' };

// Beyond this many rows the remainder is summed into OVERFLOW_LABEL. Eight
// named lines plus the header, total and blessing is ~4 SMS segments in
// GSM-7 — the ceiling worth spending on a courtesy notification.
const MAX_SMS_LINE_ITEMS = 8;

// Month names for the {{month}} placeholder. The statement SMS previously
// rendered "09-2026", which is a machine format in a message a church member
// reads on their phone — "Septemba 2026" is what the requested [MONTH_YEAR]
// slot is actually asking for.
const MONTH_NAMES = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  sw: ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'],
};

// `month` is 1-12 (as validated by validateYearMonth), not a 0-indexed JS
// month. Falls back to the numeric form rather than throwing — a statement
// SMS must never fail to send because of a label.
export function formatSmsMonthYear(year, month, locale = 'en') {
  const names = MONTH_NAMES[locale] ?? MONTH_NAMES.en;
  const name = names[Number(month) - 1];
  return name ? `${name} ${year}` : `${String(month).padStart(2, '0')}-${year}`;
}

// Renders statement.service.js's `lineItems` into the {{lines}} block of
// monthly_statement. `formatAmount` is injected rather than imported so this
// module stays dependency-free and unit-testable without the money helpers —
// callers pass formatMoney (moneyFormat.js), exactly as they already do for
// {{total}}.
//
// Returns '' for an empty month, which renders a statement with no line
// block at all rather than a dangling header — a member with no recorded
// giving still gets a coherent message.
export function formatSmsLineItems(lineItems = [], currency = 'TZS', formatAmount = String, locale = 'en') {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return '';

  const named = lineItems.slice(0, MAX_SMS_LINE_ITEMS);
  const overflow = lineItems.slice(MAX_SMS_LINE_ITEMS);

  const rows = named.map((item) => `- ${item.label}: ${currency} ${formatAmount(item.amount)}`);

  if (overflow.length > 0) {
    // Summed as a Number here rather than through sumMoney: this is display
    // text for an SMS, not a ledger figure, and the authoritative total is
    // {{total}} which is computed by the financial helpers upstream.
    const rolled = overflow.reduce((sum, item) => sum + Number(item.amount), 0);
    const label = OVERFLOW_LABEL[locale] ?? OVERFLOW_LABEL.en;
    rows.push(`- ${label}: ${currency} ${formatAmount(rolled.toFixed(2))}`);
  }

  return rows.join('\n');
}

export function renderTemplate(templateKey, locale, params = {}) {
  const localeTemplates = TEMPLATES[templateKey];
  if (!localeTemplates) {
    throw new Error(`Unknown SMS template key: ${templateKey}`);
  }
  const template = localeTemplates[locale] ?? localeTemplates.en;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => (params[key] !== undefined && params[key] !== null ? String(params[key]) : ''));
}

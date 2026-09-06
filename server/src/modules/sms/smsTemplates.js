// SWAHILI-ONLY SMS bodies, keyed the same way sms_log.template_key is
// stored. `renderTemplate()` below is the entire interpolation engine
// (`{{key}}` substitution), matching the codebase's existing philosophy of
// not reaching for a package for a few lines of logic (see exporters.js's
// hand-rolled CSV escaping).
//
// WHY THERE IS NO ENGLISH SET ANY MORE
// -----------------------------------
// This module used to hold an `{ en, sw }` pair per template and pick
// between them by locale. Three separate things could then still select the
// English string, and live logs showed all of them arriving on real phones:
//   1. contributors.locale === 'en' on any row created before migration 0034
//      (which deliberately reset tenants.locale_default but NOT the
//      per-contributor override), so those members kept getting English;
//   2. tenants.locale_default === 'en' on any tenant created before that
//      migration, or by tenants.repository.js which hardcoded 'en' on INSERT;
//   3. any unrecognised locale value hitting the `?? .en` fallback.
// Patching the fallbacks one at a time kept missing case 1, because that is
// real per-row data rather than a code default — no code change reaches it.
//
// Deleting the English strings is what actually makes the guarantee hold:
// there is now no English text for any code path, data value, or future
// caller to select. Every message is Swahili by construction.
//
// TRADE-OFF, stated plainly: a contributor with locale='en' now receives
// Swahili too. That is the explicit product requirement ("every out-of-band
// text message must resolve as 100% Swahili"). PDF/receipt documents are
// unaffected — those keep their own bilingual label sets (receiptLabels.js,
// statementLabels.js) and still honour locale.
//
// A placeholder with no matching key in `params` renders as empty rather
// than literal `{{...}}` text, since this goes to a real person's phone.
const TEMPLATES = {
  member_registration:
    '{{churchName}}\nKaribu {{memberName}}.\nNamba yako ya Uchangiaji ni {{memberNumber}}.\nNenosiri la kuingia ni: {{pin}}\nTafadhali badilisha nenosiri baada ya kuingia.\nFuatilia michango yako: {{portalUrl}}',

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
  contribution_confirmation:
    '{{churchName}}\nTunakushukuru {{memberName}} kwa mchango wako wa {{currency}} {{amount}} tarehe {{date}}.\nKumbukumbu: {{reference}}\nMungu akubariki sana.',

  // {{lines}} is a PRE-RENDERED block, not a scalar — build it with
  // formatSmsLineItems() below and pass the result. It expands to one
  // "<Fund>: <CUR> <amount>" row per distinct giving purpose the member
  // actually recorded that month (Zaka, Sadaka ya Kambi, Mfuko wa Ujenzi,
  // Makambi 2027, Effort-maendeleo, …), replacing the fixed
  // Zaka/Sadaka/Zinginezo triplet that collapsed every designated fund into
  // one anonymous "Zinginezo" figure.
  //
  // Fund labels are printed EXACTLY as the tenant named them in the
  // database — never translated, title-cased or otherwise rewritten.
  //
  // The currency prefix is baked into each rendered line by
  // formatSmsLineItems (it takes `currency` itself), so unlike {{total}}
  // there is no {{currency}} in front of {{lines}} here.
  monthly_statement:
    '{{churchName}}\nRipoti ya Utoaji ya {{month}} kwa {{memberName}}.\n{{lines}}\nJumla Kuu: {{currency}} {{total}}\nMungu akubariki sana.',
};

// Label used to roll up the tail of a very long breakdown. A member who gave
// to fifteen funds in one month would otherwise get a six-segment SMS, which
// is a real per-message cost to the church and is truncated outright by some
// handsets. The rolled-up rows are never hidden — they are summed into one
// visible line, and the full detail is always in the PDF statement.
const OVERFLOW_LABEL = 'Mifuko mingine';

// The one locale any SMS is ever rendered in. Exported so sms.service.js can
// stamp the same value on the sms_log row it writes — logging locale='en'
// beside a Swahili body would make the audit trail lie about what was sent.
export const SMS_LOCALE = 'sw';

// Beyond this many rows the remainder is summed into OVERFLOW_LABEL. Eight
// named lines plus the header, total and blessing is ~4 SMS segments in
// GSM-7 — the ceiling worth spending on a courtesy notification.
const MAX_SMS_LINE_ITEMS = 8;

// Month names for the {{month}} placeholder. The statement SMS previously
// rendered "09-2026", which is a machine format in a message a church member
// reads on their phone — "Septemba 2026" is what the requested [MONTH_YEAR]
// slot is actually asking for.
// Swahili month names only — the English set is gone for the same reason
// the English templates are (see the TEMPLATES header). A statement reading
// "Ripoti ya Utoaji ya September 2026" was the most visible half-translated
// artefact of the old bilingual selection.
const MONTH_NAMES = [
  'Januari',
  'Februari',
  'Machi',
  'Aprili',
  'Mei',
  'Juni',
  'Julai',
  'Agosti',
  'Septemba',
  'Oktoba',
  'Novemba',
  'Desemba',
];

// `month` is 1-12 (as validated by validateYearMonth), not a 0-indexed JS
// month. Falls back to the numeric form rather than throwing — a statement
// SMS must never fail to send because of a label. The trailing locale
// argument is accepted and ignored so existing call sites keep working.
export function formatSmsMonthYear(year, month) {
  const name = MONTH_NAMES[Number(month) - 1];
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
export function formatSmsLineItems(lineItems = [], currency = 'TZS', formatAmount = String) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return '';

  const named = lineItems.slice(0, MAX_SMS_LINE_ITEMS);
  const overflow = lineItems.slice(MAX_SMS_LINE_ITEMS);

  // No "- " bullet prefix. A dash renders as literal punctuation in a plain
  // SMS — there is no list formatting to opt into — so it read as noise on
  // the handset, and on a message whose first line happened to be a fund it
  // put a stray dash at the very start of the text. One item per line,
  // separated by \n, is the whole formatting mechanism a message body has.
  //
  // `item.label` is emitted VERBATIM. These are tenant-authored fund names
  // ("Makambi 2027", "Effort-maendeleo", "Sadaka ya Kambi") read straight
  // from contribution_items.purpose / categories.name — never translated,
  // re-cased or normalised, because the name the member recognises is the
  // one their church actually wrote down.
  const rows = named.map((item) => `${item.label}: ${currency} ${formatAmount(item.amount)}`);

  if (overflow.length > 0) {
    // Summed as a Number here rather than through sumMoney: this is display
    // text for an SMS, not a ledger figure, and the authoritative total is
    // {{total}} which is computed by the financial helpers upstream.
    const rolled = overflow.reduce((sum, item) => sum + Number(item.amount), 0);
    rows.push(`${OVERFLOW_LABEL}: ${currency} ${formatAmount(rolled.toFixed(2))}`);
  }

  return rows.join('\n');
}

// Final pass over every rendered body, applied inside renderTemplate so no
// call site can forget it.
//
// The problem it solves: templates embed block placeholders on their own
// line (`...kwa {{memberName}}.\n{{lines}}\nJumla Kuu:...`). When the block
// is empty — a member with nothing recorded that month — substitution leaves
// `\n\n`, i.e. a blank line mid-message, and for a body whose first
// placeholder is empty it leaves the text starting on a blank line. Rather
// than making every template defend against its own empty params, the body
// is normalised once, here:
//
//   · runs of blank lines collapse to a single newline
//   · leading dashes / bullet ticks / whitespace are stripped from the START
//     of the message (never from interior lines, which may legitimately
//     contain a hyphenated fund name)
//   · trailing whitespace is trimmed
// No template in this module contains a deliberate blank line, so dropping
// every empty line outright is both correct and simpler than trying to
// preserve intentional ones.
function tidySmsBody(body) {
  const lines = body
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  // Leading bullet punctuation is stripped from the first line only.
  // Interior lines are left alone: "Sadaka ya Kambi - Watoto" is a fund name
  // a tenant may legitimately have typed, not formatting to clean up.
  if (lines.length > 0) lines[0] = lines[0].replace(/^[\s\-–—•*]+/, '');
  return lines.join('\n');
}

/**
 * Renders an SMS body. Always Swahili.
 *
 * The `locale` parameter is accepted and DELIBERATELY IGNORED. Keeping it in
 * the signature means every existing call site (and sms_log's own locale
 * column) keeps working unchanged, while there is no longer any value a
 * caller — or a stale contributors.locale row — can pass that produces
 * English. Removing the parameter instead would have silently shifted
 * `params` into its position at three call sites.
 */
export function renderTemplate(templateKey, _locale, params = {}) {
  const template = TEMPLATES[templateKey];
  if (!template) {
    throw new Error(`Unknown SMS template key: ${templateKey}`);
  }
  const body = template.replace(/\{\{(\w+)\}\}/g, (_match, key) =>
    params[key] !== undefined && params[key] !== null ? String(params[key]) : ''
  );
  return tidySmsBody(body);
}

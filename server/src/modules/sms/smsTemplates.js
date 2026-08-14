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
  contribution_confirmation: {
    en: '{{churchName}}\nThank you {{memberName}} for your contribution of {{amount}} on {{date}}.\nReference: {{reference}}\nGod bless you.',
    sw: '{{churchName}}\nAsante {{memberName}} kwa mchango wako wa {{amount}} tarehe {{date}}.\nKumbukumbu: {{reference}}\nMungu akubariki.',
  },
  monthly_statement: {
    en: '{{churchName}}\n{{month}} Giving Statement for {{memberName}}\nTithe: {{tithe}}\nOffering: {{offering}}\nOther: {{other}}\nGrand Total: {{total}}\nGod bless you.',
    sw: '{{churchName}}\nTaarifa ya Matoleo ya {{month}} kwa {{memberName}}\nZaka: {{tithe}}\nSadaka: {{offering}}\nMatoleo Mengine: {{other}}\nJumla Kuu: {{total}}\nMungu akubariki.',
  },
};

export function renderTemplate(templateKey, locale, params = {}) {
  const localeTemplates = TEMPLATES[templateKey];
  if (!localeTemplates) {
    throw new Error(`Unknown SMS template key: ${templateKey}`);
  }
  const template = localeTemplates[locale] ?? localeTemplates.en;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => (params[key] !== undefined && params[key] !== null ? String(params[key]) : ''));
}

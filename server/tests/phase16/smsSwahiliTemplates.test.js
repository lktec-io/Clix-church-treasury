// Pure-unit coverage for the Swahili SMS pass. No DB, no network — these
// assert the rendered text a church member actually receives.
import { describe, it, expect } from 'vitest';
import { renderTemplate, formatSmsMonthYear, formatSmsLineItems } from '../../src/modules/sms/smsTemplates.js';

describe('Swahili contribution receipt (Template A)', () => {
  const params = {
    churchName: 'Kanisa la Mfano',
    memberName: 'Neema Joseph',
    currency: 'TZS',
    amount: '50,000.00',
    date: '2026-09-03',
    reference: 'RCP-000123',
  };

  it('renders the exact requested wording', () => {
    expect(renderTemplate('contribution_confirmation', 'sw', params)).toBe(
      'Kanisa la Mfano\n' +
        'Tunakushukuru Neema Joseph kwa mchango wako wa TZS 50,000.00 tarehe 2026-09-03.\n' +
        'Kumbukumbu: RCP-000123\n' +
        'Mungu akubariki sana.'
    );
  });

  // The regression this pass was most at risk of: `amount` used to arrive
  // pre-prefixed with the currency, so putting TZS in the template too would
  // have produced "TZS TZS 50,000.00" on every single receipt.
  it('does not double the currency code', () => {
    const body = renderTemplate('contribution_confirmation', 'sw', params);
    expect(body).toContain('TZS 50,000.00');
    expect(body).not.toContain('TZS TZS');
  });

  it('leaves no unsubstituted placeholders', () => {
    expect(renderTemplate('contribution_confirmation', 'sw', params)).not.toMatch(/\{\{|\}\}/);
  });
});

describe('Swahili monthly statement (Template B)', () => {
  // Mirrors what contributors.controller.js passes: `lines` is a
  // pre-rendered block from formatSmsLineItems, not a scalar.
  const lineItems = [
    { label: 'Zaka', amount: '120000.00' },
    { label: 'Sadaka ya Kambi', amount: '45000.00' },
    { label: 'Mfuko wa Ujenzi', amount: '10000.00' },
  ];
  const params = {
    churchName: 'Kanisa la Mfano',
    memberName: 'Neema Joseph',
    month: 'Septemba 2026',
    currency: 'TZS',
    lines: formatSmsLineItems(lineItems, 'TZS', (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }), 'sw'),
    total: '175,000.00',
  };

  it('renders the exact requested wording, one line per fund given to', () => {
    expect(renderTemplate('monthly_statement', 'sw', params)).toBe(
      'Kanisa la Mfano\n' +
        'Ripoti ya Utoaji ya Septemba 2026 kwa Neema Joseph.\n' +
        'Zaka: TZS 120,000.00\n' +
        'Sadaka ya Kambi: TZS 45,000.00\n' +
        'Mfuko wa Ujenzi: TZS 10,000.00\n' +
        'Jumla Kuu: TZS 175,000.00\n' +
        'Mungu akubariki sana.'
    );
  });

  it('prefixes every figure with the currency exactly once', () => {
    const body = renderTemplate('monthly_statement', 'sw', params);
    expect(body.match(/TZS/g)).toHaveLength(4);
  });

  it('names a designated fund explicitly instead of folding it into "Zinginezo"', () => {
    const body = renderTemplate('monthly_statement', 'sw', params);
    expect(body).toContain('Mfuko wa Ujenzi');
    expect(body).not.toContain('Zinginezo');
  });

  it('leaves no unsubstituted placeholders', () => {
    expect(renderTemplate('monthly_statement', 'sw', params)).not.toMatch(/\{\{|\}\}/);
  });
});

describe('formatSmsLineItems', () => {
  const fmt = (v) => Number(v).toFixed(2);

  // No bullet prefix: a dash is literal punctuation in an SMS, and on a
  // message whose first line is a fund it left a stray dash at the very
  // start of the text.
  it('renders one plain row per fund, currency-prefixed, with no bullet dash', () => {
    expect(formatSmsLineItems([{ label: 'Zaka', amount: '1000.00' }], 'TZS', fmt, 'sw')).toBe('Zaka: TZS 1000.00');
  });

  it('returns an empty block for a month with nothing recorded', () => {
    expect(formatSmsLineItems([], 'TZS', fmt, 'sw')).toBe('');
    expect(formatSmsLineItems(undefined, 'TZS', fmt, 'sw')).toBe('');
  });

  it('honours a non-TZS tenant currency', () => {
    expect(formatSmsLineItems([{ label: 'Tithe', amount: '5.00' }], 'KES', fmt, 'en')).toBe('Tithe: KES 5.00');
  });

  // The cost guard: a member giving to a dozen funds must not trigger a
  // six-segment SMS. Everything past the eighth row is summed into one
  // labelled line — rolled up, never dropped.
  it('rolls the tail beyond eight funds into one summed line', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ label: `Fund ${i + 1}`, amount: '100.00' }));
    const rows = formatSmsLineItems(many, 'TZS', fmt, 'sw').split('\n');
    expect(rows).toHaveLength(9);
    expect(rows[8]).toBe('Mifuko mingine: TZS 300.00');
  });

  it('labels the rolled-up line in English for an English statement', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ label: `Fund ${i + 1}`, amount: '50.00' }));
    expect(formatSmsLineItems(many, 'TZS', fmt, 'en')).toContain('Other funds: TZS 100.00');
  });
});

describe('rendered bodies are clean text, never bullet-list debris', () => {
  const TEMPLATE_KEYS = ['member_registration', 'contribution_confirmation', 'monthly_statement'];

  // The invariant the "remove prefix dashes" pass exists to hold: whatever
  // the params, no message may open with a dash or bullet tick.
  it.each(TEMPLATE_KEYS)('%s never starts with a dash or bullet, even with empty params', (key) => {
    expect(renderTemplate(key, 'sw', {})).not.toMatch(/^[\s\-–—•*]/);
  });

  it.each(TEMPLATE_KEYS)('%s never contains a blank line', (key) => {
    expect(renderTemplate(key, 'sw', {})).not.toMatch(/\n\s*\n/);
  });

  // The specific case that produced one: {{lines}} sits on its own line, so
  // a member with nothing recorded that month left `\n\n` mid-message.
  it('drops the line block entirely for a member with nothing recorded', () => {
    const body = renderTemplate('monthly_statement', 'sw', {
      churchName: 'Kanisa la Mfano',
      memberName: 'Neema Joseph',
      month: 'Septemba 2026',
      currency: 'TZS',
      lines: formatSmsLineItems([], 'TZS', String, 'sw'),
      total: '0.00',
    });
    expect(body).toBe(
      'Kanisa la Mfano\n' +
        'Ripoti ya Utoaji ya Septemba 2026 kwa Neema Joseph.\n' +
        'Jumla Kuu: TZS 0.00\n' +
        'Mungu akubariki sana.'
    );
  });

  // A hyphen inside a tenant's own fund name is data, not formatting.
  it('does not strip a dash from the middle of a line', () => {
    const lines = formatSmsLineItems([{ label: 'Sadaka - Watoto', amount: '100.00' }], 'TZS', String, 'sw');
    const body = renderTemplate('monthly_statement', 'sw', { churchName: 'K', memberName: 'N', lines, total: '100.00' });
    expect(body).toContain('Sadaka - Watoto: TZS 100.00');
  });
});

describe('formatSmsMonthYear', () => {
  it('uses Swahili month names', () => {
    expect(formatSmsMonthYear(2026, 9, 'sw')).toBe('Septemba 2026');
    expect(formatSmsMonthYear(2026, 1, 'sw')).toBe('Januari 2026');
    expect(formatSmsMonthYear(2026, 12, 'sw')).toBe('Desemba 2026');
  });

  it('uses English month names for en', () => {
    expect(formatSmsMonthYear(2026, 9, 'en')).toBe('September 2026');
  });

  // month is 1-12 from validateYearMonth, not a 0-indexed JS month — this
  // pins that boundary so an off-by-one can't silently ship.
  it('treats month as 1-indexed', () => {
    expect(formatSmsMonthYear(2026, 1, 'en')).toBe('January 2026');
    expect(formatSmsMonthYear(2026, 12, 'en')).toBe('December 2026');
  });

  it('falls back to a numeric label rather than throwing on a bad month', () => {
    expect(formatSmsMonthYear(2026, 13, 'sw')).toBe('13-2026');
    expect(formatSmsMonthYear(2026, 0, 'sw')).toBe('00-2026');
  });

  it('falls back to Swahili month names for an unknown locale', () => {
    expect(formatSmsMonthYear(2026, 9, 'fr')).toBe('Septemba 2026');
  });

  it('defaults to Swahili when no locale is supplied at all', () => {
    expect(formatSmsMonthYear(2026, 9)).toBe('Septemba 2026');
  });
});

describe('registration template still carries the PIN', () => {
  // Guards the reason enrollment.service.js#withoutPinPreview exists: this
  // body is genuinely sensitive, so `preview` must never be returned for it.
  it('embeds the raw PIN in the body', () => {
    const body = renderTemplate('member_registration', 'sw', { memberName: 'X', pin: '4821' });
    expect(body).toContain('4821');
  });
});

// Pure-unit coverage for the Swahili SMS pass. No DB, no network — these
// assert the rendered text a church member actually receives.
import { describe, it, expect } from 'vitest';
import { renderTemplate, formatSmsMonthYear } from '../../src/modules/sms/smsTemplates.js';

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
  const params = {
    churchName: 'Kanisa la Mfano',
    memberName: 'Neema Joseph',
    month: 'Septemba 2026',
    currency: 'TZS',
    tithe: '120,000.00',
    offering: '45,000.00',
    other: '10,000.00',
    total: '175,000.00',
  };

  it('renders the exact requested wording', () => {
    expect(renderTemplate('monthly_statement', 'sw', params)).toBe(
      'Kanisa la Mfano\n' +
        'Ripoti ya Utoaji ya Septemba 2026 kwa Neema Joseph.\n' +
        'Zaka: TZS 120,000.00\n' +
        'Sadaka: TZS 45,000.00\n' +
        'Zinginezo: TZS 10,000.00\n' +
        'Jumla Kuu: TZS 175,000.00\n' +
        'Mungu akubariki sana.'
    );
  });

  it('prefixes every figure with the currency exactly once', () => {
    const body = renderTemplate('monthly_statement', 'sw', params);
    expect(body.match(/TZS/g)).toHaveLength(4);
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

  it('falls back to English month names for an unknown locale', () => {
    expect(formatSmsMonthYear(2026, 9, 'fr')).toBe('September 2026');
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

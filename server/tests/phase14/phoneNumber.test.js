import { describe, it, expect } from 'vitest';
import { normalizeTzPhone } from '../../src/modules/sms/phoneNumber.js';

// Pure function, no DB/network — the phone-format cases from the backend
// stabilization checklist (Phase 6/20: 07.../06.../255.../+255...) plus the
// malformed-input cases every real send path needs to reject before ever
// reaching Beem.
describe('normalizeTzPhone', () => {
  it('normalizes 10-digit local 07/06 numbers to 255-prefixed', () => {
    expect(normalizeTzPhone('0712345678')).toBe('255712345678');
    expect(normalizeTzPhone('0612345678')).toBe('255612345678');
  });

  it('normalizes 10-digit local numbers written with spaces/dashes', () => {
    expect(normalizeTzPhone('071 234 5678')).toBe('255712345678');
    expect(normalizeTzPhone('071-234-5678')).toBe('255712345678');
  });

  it('accepts 12-digit 255-prefixed numbers as-is', () => {
    expect(normalizeTzPhone('255712345678')).toBe('255712345678');
    expect(normalizeTzPhone('255612345678')).toBe('255612345678');
  });

  it('strips a leading + from the 255-prefixed form', () => {
    expect(normalizeTzPhone('+255712345678')).toBe('255712345678');
    expect(normalizeTzPhone('+255 712 345 678')).toBe('255712345678');
  });

  it('accepts a bare 9-digit number (no leading 0, no country code)', () => {
    expect(normalizeTzPhone('712345678')).toBe('255712345678');
  });

  it('rejects a non-mobile Tanzanian prefix (e.g. landline 0 2x)', () => {
    expect(normalizeTzPhone('0212345678')).toBeNull();
  });

  it('rejects the wrong digit count', () => {
    expect(normalizeTzPhone('07123456')).toBeNull(); // too short
    expect(normalizeTzPhone('071234567890')).toBeNull(); // too long
  });

  it('rejects non-numeric garbage without throwing', () => {
    expect(normalizeTzPhone('not-a-phone-number')).toBeNull();
    expect(normalizeTzPhone('')).toBeNull();
  });

  it('rejects non-string input without throwing', () => {
    expect(normalizeTzPhone(null)).toBeNull();
    expect(normalizeTzPhone(undefined)).toBeNull();
    expect(normalizeTzPhone(255712345678)).toBeNull();
  });

  it('rejects a 255-prefixed number with a non-mobile third digit', () => {
    expect(normalizeTzPhone('255212345678')).toBeNull();
  });
});

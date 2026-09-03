// Regression cover for the blank-page incident: formatMoney was called with
// a Number by the dashboard's fund donut and threw
// "amountString.startsWith is not a function", which unmounted the React
// tree and rendered a blank page immediately after login.
import { describe, it, expect } from 'vitest';
import { formatMoney, formatCurrency, sumMoneyStrings, sanitizeAmountInput } from './format.js';

describe('formatMoney — never throws', () => {
  it('formats the normal decimal-string case', () => {
    expect(formatMoney('1234567.89')).toBe('1,234,567.89');
    expect(formatMoney('0.00')).toBe('0.00');
    expect(formatMoney('-4500.50')).toBe('-4,500.50');
  });

  // The exact crash.
  it('accepts a plain number without throwing', () => {
    expect(() => formatMoney(175000)).not.toThrow();
    expect(formatMoney(175000)).toBe('175,000.00');
    expect(formatMoney(-2500.5)).toBe('-2,500.50');
    expect(formatMoney(0)).toBe('0.00');
  });

  // A legitimate zero must render as a real balance, never as an em dash.
  // This is why the coercion uses `?? ''` and not `|| ''`.
  it('renders zero as a value, not as a placeholder', () => {
    expect(formatMoney(0)).not.toBe('—');
    expect(formatMoney('0.00')).not.toBe('—');
    expect(formatMoney('0')).toBe('0.00');
  });

  it('returns the placeholder for null and undefined', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
  });

  it('returns the placeholder for values that cannot be money, without throwing', () => {
    for (const bad of [{}, [], true, NaN, Infinity, -Infinity, '', '   ']) {
      expect(() => formatMoney(bad)).not.toThrow();
      expect(formatMoney(bad)).toBe('—');
    }
  });

  it('formatCurrency inherits the same safety', () => {
    expect(() => formatCurrency(175000)).not.toThrow();
    expect(formatCurrency(175000)).toBe('TZS 175,000.00');
    expect(formatCurrency(null)).toBe('—');
  });
});

describe('sumMoneyStrings', () => {
  it('sums decimal strings via integer cents', () => {
    expect(sumMoneyStrings(['120000.00', '45000.00', '10000.00'])).toBe('175000.00');
    expect(sumMoneyStrings(['0.01', '0.02'])).toBe('0.03');
  });

  it('handles negatives and an empty list', () => {
    expect(sumMoneyStrings(['100.00', '-40.50'])).toBe('59.50');
    expect(sumMoneyStrings([])).toBe('0.00');
  });

  it('accepts numbers as well as strings', () => {
    expect(() => sumMoneyStrings([1000, '500.25'])).not.toThrow();
    expect(sumMoneyStrings([1000, '500.25'])).toBe('1500.25');
  });

  // One bad entry used to turn every total on the page into "NaN".
  it('ignores unusable entries instead of poisoning the whole sum', () => {
    expect(sumMoneyStrings(['100.00', null, undefined, 'abc', '', '50.00'])).toBe('150.00');
  });

  it('does not throw on a non-array', () => {
    expect(() => sumMoneyStrings(null)).not.toThrow();
    expect(sumMoneyStrings(null)).toBe('0.00');
  });
});

describe('sanitizeAmountInput', () => {
  it('strips separators the backend money validator rejects', () => {
    expect(sanitizeAmountInput('10,000.50')).toBe('10000.50');
    expect(sanitizeAmountInput(' 1 234 ')).toBe('1234');
    expect(sanitizeAmountInput(null)).toBe('');
  });
});

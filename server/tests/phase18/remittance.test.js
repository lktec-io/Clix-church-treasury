// Pure-unit coverage for the higher-body remittance engine's arithmetic and
// input rules. No DB — the accrual/payout flow itself needs a database and
// is covered by the integration suite.
import { describe, it, expect } from 'vitest';
import { computeRemittanceShare } from '../../src/modules/remittance/remittance.service.js';
import { validateCreateRule, validateRemitPayment } from '../../src/modules/remittance/remittance.validator.js';

describe('computeRemittanceShare', () => {
  // The canonical SDA case: the whole tithe goes up.
  it('remits 100% exactly', () => {
    expect(computeRemittanceShare('100000.00', '100.00')).toBe('100000.00');
    expect(computeRemittanceShare('999999.99', '100.00')).toBe('999999.99');
  });

  it('computes a whole percentage', () => {
    expect(computeRemittanceShare('100000.00', '10.00')).toBe('10000.00');
    expect(computeRemittanceShare('12345.67', '15.00')).toBe('1851.85');
  });

  it('computes a fractional percentage', () => {
    expect(computeRemittanceShare('50000.00', '33.33')).toBe('16665.00');
  });

  it('accrues nothing at 0%', () => {
    expect(computeRemittanceShare('100.00', '0.00')).toBe('0.00');
  });

  // Rounds half-up so the local church never under-remits by a rounding
  // choice — the Conference reconciles against its own figures.
  it('rounds half-up at the cent', () => {
    expect(computeRemittanceShare('0.01', '50.00')).toBe('0.01');
  });

  // The reason the whole calculation runs in BigInt cents: this is a debt
  // that gets reconciled against another organisation's books, and binary
  // floating point cannot represent these values exactly.
  it('is exact where float arithmetic drifts', () => {
    // 0.1 + 0.2 style drift, applied to money.
    expect(computeRemittanceShare('0.70', '10.00')).toBe('0.07');
    expect(computeRemittanceShare('1000000.00', '33.33')).toBe('333300.00');
  });
});

describe('validateCreateRule', () => {
  const valid = { fundId: 4, higherBodyName: 'Northern Tanzania Conference', percentageToRemit: '100.00' };

  it('accepts a complete rule', () => {
    expect(validateCreateRule(valid)).toEqual({
      fundId: 4,
      higherBodyName: 'Northern Tanzania Conference',
      percentageToRemit: '100.00',
    });
  });

  // A church cannot owe more than it received.
  it('rejects a percentage above 100', () => {
    expect(() => validateCreateRule({ ...valid, percentageToRemit: '101.00' })).toThrow();
  });

  it('rejects a non-numeric or over-precise percentage', () => {
    expect(() => validateCreateRule({ ...valid, percentageToRemit: 'ten' })).toThrow();
    expect(() => validateCreateRule({ ...valid, percentageToRemit: '10.005' })).toThrow();
  });

  it('requires a receiving body and a fund', () => {
    expect(() => validateCreateRule({ ...valid, higherBodyName: '   ' })).toThrow();
    expect(() => validateCreateRule({ ...valid, fundId: 0 })).toThrow();
  });
});

describe('validateRemitPayment', () => {
  it('accepts a payment', () => {
    expect(validateRemitPayment({ accountId: 2, amount: '5000.00' })).toEqual({
      accountId: 2,
      amount: '5000.00',
      description: null,
    });
  });

  it('rejects a non-positive or over-precise amount', () => {
    expect(() => validateRemitPayment({ accountId: 2, amount: '0.00' })).toThrow();
    expect(() => validateRemitPayment({ accountId: 2, amount: '-5.00' })).toThrow();
    expect(() => validateRemitPayment({ accountId: 2, amount: '5.001' })).toThrow();
  });

  it('requires the paying account', () => {
    expect(() => validateRemitPayment({ amount: '5000.00' })).toThrow();
  });
});

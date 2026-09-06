import { describe, it, expect } from 'vitest';
import { validateCreateTenant, validateUpdateTenant, validateTenantStatus } from '../../src/modules/platform/platform.validator.js';

function validPayload(overrides = {}) {
  return {
    churchName: 'Grace Church',
    adminFullName: 'John Doe',
    adminEmail: 'john@gracechurch.com',
    adminPassword: 'a-very-long-password',
    ...overrides,
  };
}

describe('validateCreateTenant', () => {
  it('accepts a valid payload and trims/lowercases as expected', () => {
    const result = validateCreateTenant(validPayload({ churchName: '  Grace Church  ', adminEmail: 'John@GraceChurch.com  '.trim() }));
    expect(result.churchName).toBe('Grace Church');
    expect(result.adminEmail).toBe('john@gracechurch.com');
  });

  it('rejects a missing church name', () => {
    expect(() => validateCreateTenant(validPayload({ churchName: '' }))).toThrow();
  });

  it('rejects a missing admin full name', () => {
    expect(() => validateCreateTenant(validPayload({ adminFullName: '' }))).toThrow();
  });

  it('rejects an invalid email', () => {
    expect(() => validateCreateTenant(validPayload({ adminEmail: 'not-an-email' }))).toThrow();
  });

  it('rejects a password shorter than 10 characters — the same rule self-registration uses', () => {
    expect(() => validateCreateTenant(validPayload({ adminPassword: 'short' }))).toThrow();
  });
});

describe('validateUpdateTenant', () => {
  // Swahili, not English — the validator has defaulted to 'sw' since
  // migration 0034 made it the tenant default, but this expectation was
  // never updated with it, so it has been failing independently of the
  // locale sweep this change is part of.
  it('accepts a valid payload with defaults for currency/locale', () => {
    const result = validateUpdateTenant({ name: 'Grace Church' });
    expect(result).toEqual({ name: 'Grace Church', baseCurrency: 'TZS', localeDefault: 'sw' });
  });

  it('rejects a malformed currency code', () => {
    expect(() => validateUpdateTenant({ name: 'Grace Church', baseCurrency: 'tzs' })).toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => validateUpdateTenant({ name: '' })).toThrow();
  });
});

describe('validateTenantStatus', () => {
  it('accepts "active" and "suspended" — the exact enum tenants.status already supports', () => {
    expect(validateTenantStatus({ status: 'active' })).toEqual({ status: 'active' });
    expect(validateTenantStatus({ status: 'suspended' })).toEqual({ status: 'suspended' });
  });

  it('rejects any other value', () => {
    expect(() => validateTenantStatus({ status: 'inactive' })).toThrow();
    expect(() => validateTenantStatus({ status: 'deleted' })).toThrow();
  });
});

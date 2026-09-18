// Pure-unit coverage for the member-identity, pledge-schedule and
// tithe-compliance rules. No DB, no network, fixed clocks.
import { describe, it, expect } from 'vitest';
import { validateNida, validateMemberIdentity } from '../../src/modules/contributors/memberId.js';
import { computePledgeSchedule } from '../../src/modules/pledges/pledgeSchedule.js';
import { titheComplianceStatus } from '../../src/modules/contributors/titheCompliance.js';
import { hardDelete, refuseDelete } from '../../src/db/deleteGuards.js';

const TODAY = new Date(Date.UTC(2026, 8, 16)); // 16 Sep 2026

describe('validateNida', () => {
  it.each([
    ['19900101123450000112', 'plain digits'],
    ['19900101-12345-00001-12', 'dashes as typed'],
    ['1990 0101 1234 5000 0112', 'spaces as typed'],
    ['20000229123450000112', 'leap day in a leap year'],
  ])('accepts %s (%s)', (input) => {
    expect(validateNida(input, TODAY).valid).toBe(true);
  });

  it.each([
    ['', 'required'],
    ['1990010112345000011', 'length'],
    ['199001011234500001123', 'length'],
    ['19900101A23450000112', 'digits_only'],
    ['11111111111111111111', 'pattern'],
    ['12345678901234567890', 'pattern'],
    ['98765432109876543210', 'pattern'],
    // A real birth date does not rescue a fabricated tail.
    ['19900101000000000000', 'pattern'],
    ['19900101123456789012', 'pattern'],
    ['18990101123450000112', 'birth_year'],
    ['20300101123450000112', 'birth_year'],
    ['19900230123450000112', 'birth_date'],
    ['19901301123450000112', 'birth_date'],
    ['19000229123450000112', 'birth_date'], // 1900 was not a leap year
    ['20260917123450000112', 'birth_future'],
  ])('rejects %s as %s', (input, reason) => {
    expect(validateNida(input, TODAY)).toEqual({ valid: false, reason });
  });

  it('returns the normalised digits for storage', () => {
    expect(validateNida('19900101-12345-00001-12', TODAY).normalized).toBe('19900101123450000112');
  });
});

describe('validateMemberIdentity', () => {
  it('treats identity as optional', () => {
    expect(validateMemberIdentity({}, TODAY)).toEqual({
      fields: {},
      value: { idType: null, idNumber: null, idNote: null },
    });
  });

  it('stores only a note for a member with no document', () => {
    expect(validateMemberIdentity({ idType: 'none', idNumber: 'ignored', idNote: '  Mzee  ' }, TODAY).value).toEqual({
      idType: 'none',
      idNumber: null,
      idNote: 'Mzee',
    });
  });

  it('enforces the NIDA rules for a NIDA document', () => {
    expect(validateMemberIdentity({ idType: 'nida', idNumber: '1111' }, TODAY).fields.idNumber).toMatch(/length/);
  });

  it('accepts and upper-cases a voter ID or licence number', () => {
    expect(validateMemberIdentity({ idType: 'voter_id', idNumber: 't-1234567' }, TODAY).value.idNumber).toBe('T-1234567');
  });

  it('rejects an unknown document type', () => {
    expect(validateMemberIdentity({ idType: 'passport' }, TODAY).fields.idType).toBeDefined();
  });
});

describe('computePledgeSchedule', () => {
  it('computes a monthly schedule and arrears', () => {
    expect(
      computePledgeSchedule(
        { pledgedAmount: '1200000.00', fulfilledAmount: '600000.00', pledgeDate: '2026-01-01', targetDate: '2026-12-31', frequency: 'monthly' },
        TODAY
      )
    ).toEqual({
      frequency: 'monthly',
      periods: 12,
      periodsElapsed: 9,
      installment: '100000.00',
      expectedToDate: '900000.00',
      arrears: '300000.00',
    });
  });

  // Rounded UP, so paying every installment always covers the pledge.
  it('rounds the installment up to the cent', () => {
    const schedule = computePledgeSchedule(
      { pledgedAmount: '1000.00', fulfilledAmount: '0', pledgeDate: '2026-09-15', targetDate: '2026-09-17', frequency: 'daily' },
      TODAY
    );
    expect(schedule.installment).toBe('333.34');
  });

  it('never reports negative arrears for a member ahead of schedule', () => {
    const schedule = computePledgeSchedule(
      { pledgedAmount: '120000.00', fulfilledAmount: '120000.00', pledgeDate: '2026-01-01', targetDate: '2026-12-01', frequency: 'monthly' },
      TODAY
    );
    expect(schedule.arrears).toBe('0.00');
  });

  it('expects nothing before the pledge starts', () => {
    const schedule = computePledgeSchedule(
      { pledgedAmount: '50000.00', fulfilledAmount: '0', pledgeDate: '2026-10-01', targetDate: '2026-12-01', frequency: 'monthly' },
      TODAY
    );
    expect(schedule.periodsElapsed).toBe(0);
    expect(schedule.expectedToDate).toBe('0.00');
  });

  it('returns null for a one-off pledge or a recurring one with no end date', () => {
    expect(computePledgeSchedule({ pledgedAmount: '1', pledgeDate: '2026-01-01', targetDate: '2026-12-01', frequency: 'once' }, TODAY)).toBeNull();
    expect(computePledgeSchedule({ pledgedAmount: '1', pledgeDate: '2026-01-01', targetDate: null, frequency: 'weekly' }, TODAY)).toBeNull();
  });
});

describe('titheComplianceStatus', () => {
  it.each([
    ['2026-09-02', 'current'],
    ['2026-08-31', 'due'],
    ['2026-07-15', 'lapsed'],
    [null, 'none'],
  ])('%s -> %s', (lastTitheDate, status) => {
    expect(titheComplianceStatus(lastTitheDate, TODAY)).toBe(status);
  });

  // 30 Sep 22:00 UTC is already 1 Oct 01:00 in Tanzania.
  it('uses the Tanzanian calendar month, not the UTC one', () => {
    const lateOnTheLastDayUtc = new Date(Date.UTC(2026, 8, 30, 22, 0));
    expect(titheComplianceStatus('2026-09-10', lateOnTheLastDayUtc)).toBe('due');
  });
});

// The hard-delete guard. Pure: no database, just the error mapping that
// decides whether a refused delete reaches the user as an explanation or as
// a crash.
describe('hardDelete guard', () => {
  const fkError = () => Object.assign(new Error('FK constraint'), { code: 'ER_ROW_IS_REFERENCED_2' });

  it('returns the result when the delete succeeds', async () => {
    await expect(hardDelete('unused message', async () => true)).resolves.toBe(true);
  });

  // The row is still referenced by financial history — a 409 that says so,
  // never a 500.
  it('turns the database FK refusal into an explained 409', async () => {
    await expect(
      hardDelete('This member has recorded giving.', async () => {
        throw fkError();
      })
    ).rejects.toMatchObject({ status: 409, message: 'This member has recorded giving.' });
  });

  // A dropped connection is not a conflict: masking it as 409 would tell the
  // user their record is protected when in fact nothing was checked.
  it('lets unrelated errors through untouched', async () => {
    await expect(
      hardDelete('unused message', async () => {
        throw Object.assign(new Error('connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
      })
    ).rejects.toMatchObject({ code: 'PROTOCOL_CONNECTION_LOST' });
  });

  it('refuseDelete states the domain reason as a 409', () => {
    expect(() => refuseDelete('This expense has been paid.')).toThrowError(/paid/i);
  });
});

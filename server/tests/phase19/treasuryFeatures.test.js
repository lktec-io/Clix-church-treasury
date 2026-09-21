// Pure-unit coverage for the member-identity, pledge-schedule and
// tithe-compliance rules. No DB, no network, fixed clocks.
import { describe, it, expect } from 'vitest';
import { validateNida, validateMemberIdentity } from '../../src/modules/contributors/memberId.js';
import { computePledgeSchedule } from '../../src/modules/pledges/pledgeSchedule.js';
import { titheComplianceStatus } from '../../src/modules/contributors/titheCompliance.js';
import { hardDelete, refuseDelete, blocker, parseForeignKeyReference } from '../../src/db/deleteGuards.js';
import { runInBackground } from '../../src/utils/backgroundJob.js';
import { requireApprovalRole, APPROVAL_ROLES } from '../../src/middleware/rbac.js';
import { permissionsRepository } from '../../src/modules/permissions/permissions.repository.js';
import { registerSchemaCache, invalidateSchemaCaches } from '../../src/db/schemaGuard.js';
import ExcelJS from 'exceljs';
import { toCsv, toExcelBuffer } from '../../src/modules/reports/exporters.js';

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

// The background runner that isolates post-commit work (the contribution
// confirmation SMS) from the request. Pure: fake jobs, no database.
describe('runInBackground', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('starts the job only after the caller has returned', async () => {
    const order = [];
    runInBackground('ordering', () => order.push('job'));
    order.push('caller returned');
    await flush();
    expect(order).toEqual(['caller returned', 'job']);
  });

  // The exact failure behind the contribution 500: an sms_log write against a
  // database missing a migration. It must be logged, never rethrown.
  it('contains a rejected job instead of letting it escape', async () => {
    const errors = [];
    const originalError = console.error;
    console.error = (message) => errors.push(message);
    let unhandled = 0;
    const onUnhandled = () => {
      unhandled += 1;
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      runInBackground('sms_log insert', async () => {
        throw Object.assign(new Error("Unknown column 'reason_code'"), { code: 'ER_BAD_FIELD_ERROR' });
      });
      runInBackground('synchronous throw', () => {
        throw new Error('gateway not configured');
      });
      await flush();
    } finally {
      console.error = originalError;
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toBe(0);
    expect(errors.join('\n')).toMatch(/sms_log insert failed/);
    expect(errors.join('\n')).toMatch(/synchronous throw failed/);
  });
});

// The row cap on list reports. A capped report that does not say it is capped
// reads as a complete one, so the warning travels into the exported file as
// well as the screen.
describe('report export truncation notice', () => {
  const columns = [
    { header: 'Date', key: 'date' },
    { header: 'Amount', key: 'amount' },
  ];
  const rows = [{ date: '2026-01-04', amount: '25000.00' }];
  const notice = 'INCOMPLETE REPORT: only the first 1,000 rows are shown.';

  it('leaves a complete CSV export exactly as it was', () => {
    expect(toCsv(rows, columns)).toBe('Date,Amount\r\n2026-01-04,25000.00');
  });

  it('appends the notice below the data so the header row never shifts', () => {
    const lines = toCsv(rows, columns, { notice }).split('\r\n');
    expect(lines[0]).toBe('Date,Amount');
    expect(lines[1]).toBe('2026-01-04,25000.00');
    expect(lines.at(-1)).toBe(`"${notice}"`);
  });

  it('writes the notice into the spreadsheet, under the data', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await toExcelBuffer(rows, columns, 'Report', { notice }));
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).getCell(1).value).toBe('Date');
    expect(sheet.getRow(2).getCell(1).value).toBe('2026-01-04');
    expect(sheet.getRow(4).getCell(1).value).toBe(notice);
  });
});

// A refused delete has to explain ITSELF: which records still point at the
// row, and how many. Without that the user is told "no" and left to guess.
describe('delete refusal details', () => {
  // Verbatim MySQL 8 text. Parsing it is how the foreign-key backstop learns
  // which table objected when the service layer did not already know.
  const FK_MESSAGE =
    'Cannot delete or update a parent row: a foreign key constraint fails ' +
    '(`clix_treasury`.`transactions`, CONSTRAINT `fk_transactions_created_by` ' +
    'FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`))';

  it('names the child table, constraint and column behind a refusal', () => {
    expect(parseForeignKeyReference({ sqlMessage: FK_MESSAGE })).toEqual({
      table: 'transactions',
      constraint: 'fk_transactions_created_by',
      column: 'created_by_user_id',
    });
  });

  it('returns null rather than guessing when the text is not a foreign-key error', () => {
    expect(parseForeignKeyReference({ message: 'Deadlock found when trying to get lock' })).toBeNull();
    expect(parseForeignKeyReference(undefined)).toBeNull();
  });

  it('turns the database refusal into a 409 carrying the offending table', async () => {
    const error = Object.assign(new Error('fk'), {
      code: 'ER_ROW_IS_REFERENCED_2',
      sqlMessage: FK_MESSAGE,
    });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await expect(
        hardDelete('This user has recorded financial records.', () => {
          throw error;
        })
      ).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
        details: { reason: 'referenced', blockers: [{ entity: 'transactions' }], constraint: 'fk_transactions_created_by' },
      });
    } finally {
      console.warn = originalWarn;
    }
  });

  it('passes any other database error through untouched', async () => {
    const error = Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' });
    await expect(hardDelete('unused', () => { throw error; })).rejects.toThrowError('deadlock');
  });

  it('carries the counts the service already measured', () => {
    try {
      refuseDelete('This member has recorded giving.', [blocker('contributions', 12), blocker('pledges', 1)]);
      throw new Error('refuseDelete should have thrown');
    } catch (error) {
      expect(error.status).toBe(409);
      expect(error.details.blockers).toEqual([
        { entity: 'contributions', count: 12 },
        { entity: 'pledges', count: 1 },
      ]);
    }
  });

  it('omits the count when the number is genuinely unknown', () => {
    expect(blocker('transactions')).toEqual({ entity: 'transactions' });
    expect(blocker('transactions', 0)).toEqual({ entity: 'transactions', count: 0 });
  });
});

// WHO MAY DECIDE AN EXPENSE. Only an Admin (Super Administrator) or a Senior
// Treasurer, re-read from the database on every request — never from the JWT.
describe('requireApprovalRole', () => {
  const runGate = async (roles, action = 'approve an expense') => {
    const original = permissionsRepository.listRoleNamesForUser;
    permissionsRepository.listRoleNamesForUser = async () => roles;
    try {
      const req = { auth: { userId: 7 } };
      let error = null;
      let passed = false;
      await requireApprovalRole(action)(req, {}, (err) => {
        if (err) error = err;
        else passed = true;
      });
      return { error, passed, req };
    } finally {
      permissionsRepository.listRoleNamesForUser = original;
    }
  };

  it('names the two authorised roles', () => {
    expect(APPROVAL_ROLES).toEqual(['Super Administrator', 'Senior Treasurer']);
  });

  it.each(APPROVAL_ROLES)('lets a %s through', async (role) => {
    const { passed, error } = await runGate([role]);
    expect(error).toBeNull();
    expect(passed).toBe(true);
  });

  it('lets a user through on the strength of one qualifying role among several', async () => {
    const { passed } = await runGate(['Viewer', 'Senior Treasurer', 'Auditor']);
    expect(passed).toBe(true);
  });

  // Treasurer and Approver each hold one half of the workflow but neither is
  // an authorised decider under this church's policy.
  it.each([['Treasurer'], ['Approver'], ['Assistant Treasurer'], ['Auditor'], ['Viewer']])(
    'refuses a %s with 403',
    async (role) => {
      const { error, passed } = await runGate([role]);
      expect(passed).toBe(false);
      expect(error.status).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
    }
  );

  it('states the gap: what is needed, what the user has, and what to do', async () => {
    const { error } = await runGate(['Treasurer'], 'mark an expense paid');
    expect(error.message).toContain('Super Administrator or Senior Treasurer');
    expect(error.message).toContain('mark an expense paid');
    expect(error.message).toContain('Treasurer');
    expect(error.message).toMatch(/ask an administrator/i);
  });

  it('handles a user with no roles at all without crashing', async () => {
    const { error } = await runGate([]);
    expect(error.status).toBe(403);
    expect(error.message).toContain('none');
  });

  it('passes a database failure on as an error rather than a silent allow', async () => {
    const original = permissionsRepository.listRoleNamesForUser;
    permissionsRepository.listRoleNamesForUser = async () => {
      throw Object.assign(new Error('no such table'), { code: 'ER_NO_SUCH_TABLE' });
    };
    try {
      let seen = null;
      let passed = false;
      await requireApprovalRole('approve')({ auth: { userId: 1 } }, {}, (err) => {
        if (err) seen = err;
        else passed = true;
      });
      expect(passed).toBe(false);
      expect(seen.code).toBe('ER_NO_SUCH_TABLE');
    } finally {
      permissionsRepository.listRoleNamesForUser = original;
    }
  });
});

// A repository that remembered "this column does not exist" used to keep
// acting on that belief until the process restarted — writing contributions
// WITHOUT the migrated columns long after the migration had run.
describe('schema cache invalidation', () => {
  it('clears every registered cache', () => {
    let a = 'stale';
    let b = 'stale';
    registerSchemaCache(() => { a = 'fresh'; });
    registerSchemaCache(() => { b = 'fresh'; });
    invalidateSchemaCaches();
    expect(a).toBe('fresh');
    expect(b).toBe('fresh');
  });

  it('clears the rest even when one resetter throws', () => {
    let reached = false;
    registerSchemaCache(() => { throw new Error('boom'); });
    registerSchemaCache(() => { reached = true; });
    expect(() => invalidateSchemaCaches()).not.toThrow();
    expect(reached).toBe(true);
  });
});

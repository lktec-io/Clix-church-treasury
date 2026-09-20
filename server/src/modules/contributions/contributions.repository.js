import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';

// Columns added by later migrations. Recording income is the core of this
// product, so a server whose database is a migration or two behind must
// still be able to do it: the optional field is dropped from the INSERT
// (with one loud warning) instead of the whole contribution failing with a
// 500 and the money going unrecorded.
//
//   department_id, mobile_provider, transfer_fee → migration 0038
//   fee_transaction_id                           → migration 0039
const OPTIONAL_COLUMNS = ['department_id', 'mobile_provider', 'transfer_fee', 'fee_transaction_id'];

let presentOptionalColumns = null;
const warnedFor = new Set();

async function resolveOptionalColumns(runner) {
  if (presentOptionalColumns) return presentOptionalColumns;
  try {
    const [rows] = await runner.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contributions' AND COLUMN_NAME IN (?)`,
      [OPTIONAL_COLUMNS]
    );
    presentOptionalColumns = new Set(rows.map((row) => row.COLUMN_NAME));
  } catch {
    // If the probe itself fails, assume none are present and write the
    // columns this table has always had.
    presentOptionalColumns = new Set();
  }
  return presentOptionalColumns;
}

// The WHERE clause shared by `search` and `sumSearch`, so a listing and its
// total can never be computed over different sets of rows.
//
// Only these keys are honoured; any other property on the filter object is
// ignored, exactly as the named-parameter version was. Callers pass a
// general-purpose filter bag (the reports controller builds one for every
// report), and a key this table has no column for must stay a no-op rather
// than become an SQL error.
const SEARCH_FILTERS = {
  contributorId: 'contributor_id = ?',
  pledgeId: 'pledge_id = ?',
  fundId: 'fund_id = ?',
  paymentMethod: 'payment_method = ?',
  dateFrom: 'contribution_date >= ?',
  dateTo: 'contribution_date <= ?',
};

function buildSearchWhere(tenantId, filters = {}) {
  assertTenantId(tenantId);
  const conditions = ['tenant_id = ?'];
  const params = [tenantId];
  for (const [key, condition] of Object.entries(SEARCH_FILTERS)) {
    if (filters[key] === undefined) continue;
    conditions.push(condition);
    params.push(filters[key]);
  }
  return { clause: conditions.join(' AND '), params };
}

class ContributionsRepository extends TenantScopedRepository {
  constructor() {
    super('contributions');
  }

  /**
   * INSERT, minus any later-migration column this database does not have.
   * Everything else about the write is unchanged.
   */
  async insert(tenantId, row, connection) {
    const present = await resolveOptionalColumns(this.runner(connection));
    const writable = { ...row };
    for (const column of OPTIONAL_COLUMNS) {
      if (writable[column] === undefined || present.has(column)) continue;
      delete writable[column];
      if (!warnedFor.has(column)) {
        warnedFor.add(column);
        console.warn(
          `[contributions] contributions.${column} is missing — this database is behind on migrations. ` +
            'Contributions are being saved WITHOUT it. Run "npm run migrate" (server/) to enable it.'
        );
      }
    }
    return super.insert(tenantId, writable, connection);
  }

  async findByTransactionId(tenantId, transactionId, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM contributions WHERE tenant_id = ? AND transaction_id = ? LIMIT 1',
      [tenantId, transactionId]
    );
    return rows[0] ?? null;
  }

  async findByIdempotencyKey(tenantId, idempotencyKey, connection) {
    assertTenantId(tenantId);
    if (!idempotencyKey) return null;
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM contributions WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1',
      [tenantId, idempotencyKey]
    );
    return rows[0] ?? null;
  }

  async search(tenantId, { limit = 50, offset = 0, ...filters } = {}, connection) {
    const { clause, params } = buildSearchWhere(tenantId, filters);
    const [rows] = await this.runner(connection).query(
      `SELECT * FROM contributions WHERE ${clause}
       ORDER BY contribution_date DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows;
  }

  /**
   * How many rows `search` would match. Used where the answer is a number
   * shown to a person — "this member has 12 contributions on record" — so
   * fetching rows to measure their length would be the wrong query.
   */
  async countSearch(tenantId, filters = {}, connection) {
    const { clause, params } = buildSearchWhere(tenantId, filters);
    const [rows] = await this.runner(connection).query(
      `SELECT COUNT(*) AS total FROM contributions WHERE ${clause}`,
      params
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Posted total for exactly the rows `search` would match, summed by MySQL
   * over every matching row rather than over the page that was fetched.
   *
   * The contributions report used to add up the row objects it had just
   * listed, which silently understated the total the moment the list hit its
   * row cap: the report showed the first N contributions and a "total" that
   * was the sum of those N, presented as the period's total giving. The
   * figure has to come from the database, independently of paging.
   */
  async sumSearch(tenantId, filters = {}, connection) {
    const { clause, params } = buildSearchWhere(tenantId, filters);
    const [rows] = await this.runner(connection).query(
      `SELECT CAST(COALESCE(SUM(amount), 0) AS DECIMAL(14,2)) AS total
         FROM contributions
        WHERE ${clause} AND status = 'posted'`,
      params
    );
    return String(rows[0]?.total ?? '0.00');
  }

  // ---------------------------------------------------------------------------
  // Dashboard / directory aggregates. Each is a single GROUP BY computed by
  // MySQL over the DECIMAL columns, so money never passes through a JS float,
  // and each is one query regardless of how many members or funds a church has.
  // ---------------------------------------------------------------------------

  /** Most recent tithe date per member — drives the directory's compliance badge. */
  async lastTitheDateByContributor(tenantId, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      `SELECT c.contributor_id, MAX(c.contribution_date) AS last_tithe_date
         FROM contributions c
         JOIN categories cat ON cat.id = c.category_id AND cat.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND c.status = 'posted' AND c.contributor_id IS NOT NULL
          AND cat.report_group = 'tithe'
        GROUP BY c.contributor_id`,
      [tenantId]
    );
    return rows;
  }

  /** Posted collections in a date range, split into tithe / offering / other. */
  async sumByReportGroup(tenantId, { dateFrom, dateTo }, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      `SELECT COALESCE(cat.report_group, 'other') AS report_group,
              CAST(COALESCE(SUM(c.amount), 0) AS DECIMAL(14,2)) AS total
         FROM contributions c
         JOIN categories cat ON cat.id = c.category_id AND cat.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND c.status = 'posted'
          AND c.contribution_date >= ? AND c.contribution_date <= ?
        GROUP BY COALESCE(cat.report_group, 'other')`,
      [tenantId, dateFrom, dateTo]
    );
    return rows;
  }

  /** Posted collections per department in a date range (migration 0038). */
  async sumByDepartment(tenantId, { dateFrom, dateTo }, connection) {
    assertTenantId(tenantId);
    // LEFT JOIN from departments so a department that received nothing this
    // period still appears with a zero, rather than silently vanishing.
    const [rows] = await this.runner(connection).query(
      `SELECT d.id, d.name,
              CAST(COALESCE(SUM(c.amount), 0) AS DECIMAL(14,2)) AS total,
              COUNT(c.id) AS contribution_count
         FROM departments d
         LEFT JOIN contributions c
           ON c.department_id = d.id AND c.tenant_id = d.tenant_id AND c.status = 'posted'
          AND c.contribution_date >= ? AND c.contribution_date <= ?
        WHERE d.tenant_id = ? AND d.is_active = TRUE
        GROUP BY d.id, d.name
        ORDER BY total DESC, d.name`,
      [dateFrom, dateTo, tenantId]
    );
    return rows;
  }

  /**
   * Mobile-money volume and agent fees per provider.
   *
   * `posted_fees` is the part of those fees that exists in the ledger as its
   * own expense transaction (migration 0039). It is summed from the LINKED
   * transaction rather than from contributions.transfer_fee, so it reports
   * what the books actually contain: fees recorded before 0039 have a
   * transfer_fee but no fee_transaction_id, and must not be counted as
   * posted. The dashboard shows the gap rather than hiding it.
   */
  async mobileMoneyFees(tenantId, { dateFrom, dateTo }, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      `SELECT COALESCE(c.mobile_provider, 'other') AS provider,
              COUNT(*) AS transaction_count,
              CAST(COALESCE(SUM(c.amount), 0) AS DECIMAL(14,2)) AS total_sent,
              CAST(COALESCE(SUM(c.transfer_fee), 0) AS DECIMAL(14,2)) AS total_fees,
              CAST(COALESCE(SUM(fee_tx.amount), 0) AS DECIMAL(14,2)) AS posted_fees
         FROM contributions c
         LEFT JOIN transactions fee_tx
           ON fee_tx.id = c.fee_transaction_id
          AND fee_tx.tenant_id = c.tenant_id
          AND fee_tx.status = 'posted'
        WHERE c.tenant_id = ? AND c.status = 'posted' AND c.payment_method = 'mobile_money'
          AND c.contribution_date >= ? AND c.contribution_date <= ?
        GROUP BY COALESCE(c.mobile_provider, 'other')
        ORDER BY total_fees DESC`,
      [tenantId, dateFrom, dateTo]
    );
    return rows;
  }
}

export const contributionsRepository = new ContributionsRepository();

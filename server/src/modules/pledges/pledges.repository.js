import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';

// Shared by `search` and `countSearch` so a listing and its count can never
// be computed over different sets of rows. Only these keys are honoured; any
// other property on the filter object is ignored, exactly as the
// named-parameter version was — callers pass general-purpose filter bags.
const SEARCH_FILTERS = {
  contributorId: 'contributor_id = ?',
  fundId: 'fund_id = ?',
  status: 'status = ?',
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

class PledgesRepository extends TenantScopedRepository {
  constructor() {
    super('pledges');
  }

  async search(tenantId, { limit = 50, offset = 0, ...filters } = {}, connection) {
    const { clause, params } = buildSearchWhere(tenantId, filters);
    const [rows] = await this.runner(connection).query(
      `SELECT * FROM pledges WHERE ${clause}
       ORDER BY pledge_date DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows;
  }

  /** How many pledges `search` would match — for counts shown to a person. */
  async countSearch(tenantId, filters = {}, connection) {
    const { clause, params } = buildSearchWhere(tenantId, filters);
    const [rows] = await this.runner(connection).query(
      `SELECT COUNT(*) AS total FROM pledges WHERE ${clause}`,
      params
    );
    return Number(rows[0]?.total ?? 0);
  }

  // Derived, never stored — same principle as account balances
  // (docs/FINANCIAL_ARCHITECTURE.md §7). Only counts posted contributions;
  // a reversed pledge payment no longer counts toward fulfillment.
  // Amount paid AND how many payments made it up, in one query. The pledge
  // list shows both ("paid 3 times"), and fetching them separately would
  // double the per-pledge round trips on a page that already makes one each.
  async getFulfillmentStats(tenantId, pledgeId, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      `SELECT CAST(COALESCE(SUM(amount), 0) AS DECIMAL(14,2)) AS fulfilled, COUNT(*) AS payment_count
         FROM contributions
        WHERE tenant_id = ? AND pledge_id = ? AND status = 'posted'`,
      [tenantId, pledgeId]
    );
    return { fulfilled: rows[0].fulfilled, paymentCount: Number(rows[0].payment_count) };
  }

  async getFulfilledAmount(tenantId, pledgeId, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      `SELECT CAST(COALESCE(SUM(amount), 0) AS DECIMAL(14,2)) AS fulfilled FROM contributions
       WHERE tenant_id = ? AND pledge_id = ? AND status = 'posted'`,
      [tenantId, pledgeId]
    );
    return rows[0].fulfilled;
  }
}

export const pledgesRepository = new PledgesRepository();

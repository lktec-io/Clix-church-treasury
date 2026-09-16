import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';

class PledgesRepository extends TenantScopedRepository {
  constructor() {
    super('pledges');
  }

  async search(tenantId, { contributorId, fundId, status, limit = 50, offset = 0 } = {}, connection) {
    assertTenantId(tenantId);
    const conditions = ['tenant_id = ?'];
    const params = [tenantId];
    if (contributorId !== undefined) {
      conditions.push('contributor_id = ?');
      params.push(contributorId);
    }
    if (fundId !== undefined) {
      conditions.push('fund_id = ?');
      params.push(fundId);
    }
    if (status !== undefined) {
      conditions.push('status = ?');
      params.push(status);
    }
    const [rows] = await this.runner(connection).query(
      `SELECT * FROM pledges WHERE ${conditions.join(' AND ')}
       ORDER BY pledge_date DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows;
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

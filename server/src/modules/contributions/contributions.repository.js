import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';

class ContributionsRepository extends TenantScopedRepository {
  constructor() {
    super('contributions');
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

  async search(tenantId, { contributorId, pledgeId, fundId, paymentMethod, dateFrom, dateTo, limit = 50, offset = 0 } = {}, connection) {
    assertTenantId(tenantId);
    const conditions = ['tenant_id = ?'];
    const params = [tenantId];
    if (contributorId !== undefined) {
      conditions.push('contributor_id = ?');
      params.push(contributorId);
    }
    if (pledgeId !== undefined) {
      conditions.push('pledge_id = ?');
      params.push(pledgeId);
    }
    if (fundId !== undefined) {
      conditions.push('fund_id = ?');
      params.push(fundId);
    }
    if (paymentMethod !== undefined) {
      conditions.push('payment_method = ?');
      params.push(paymentMethod);
    }
    if (dateFrom !== undefined) {
      conditions.push('contribution_date >= ?');
      params.push(dateFrom);
    }
    if (dateTo !== undefined) {
      conditions.push('contribution_date <= ?');
      params.push(dateTo);
    }
    const [rows] = await this.runner(connection).query(
      `SELECT * FROM contributions WHERE ${conditions.join(' AND ')}
       ORDER BY contribution_date DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows;
  }
}

export const contributionsRepository = new ContributionsRepository();

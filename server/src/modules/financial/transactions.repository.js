import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';

class TransactionsRepository extends TenantScopedRepository {
  constructor() {
    super('transactions');
  }

  async findByTransactionNumber(tenantId, transactionNumber, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM transactions WHERE tenant_id = ? AND transaction_number = ? LIMIT 1',
      [tenantId, transactionNumber]
    );
    return rows[0] ?? null;
  }

  // SUM is computed by MySQL over the DECIMAL column and returned as a
  // string — see money.js. This is the one authoritative balance query;
  // every "balance" in the system is this query with different filters.
  async sumSigned(tenantId, { accountId, fundId, financialPeriodId, connection } = {}) {
    assertTenantId(tenantId);
    const conditions = ['tenant_id = ?', "status = 'posted'"];
    const params = [tenantId];
    if (accountId !== undefined) {
      conditions.push('account_id = ?');
      params.push(accountId);
    }
    if (fundId !== undefined) {
      conditions.push('fund_id = ?');
      params.push(fundId);
    }
    if (financialPeriodId !== undefined) {
      conditions.push('financial_period_id = ?');
      params.push(financialPeriodId);
    }
    // CAST(...AS DECIMAL(14,2)) rather than a bare COALESCE(..., 0) fallback
    // — with no matching rows, SUM() is NULL and the integer literal 0
    // COALESCE falls back to is not guaranteed to carry the same 2-decimal
    // formatting as a real DECIMAL(14,2) SUM result. The CAST makes the
    // empty-result and has-results cases format identically, always "X.XX".
    const [rows] = await this.runner(connection).query(
      `SELECT CAST(COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS DECIMAL(14,2)) AS balance
       FROM transactions WHERE ${conditions.join(' AND ')}`,
      params
    );
    return rows[0].balance;
  }

  async sumByType(tenantId, type, { financialPeriodId, fundId, categoryId, connection } = {}) {
    assertTenantId(tenantId);
    const conditions = ['tenant_id = ?', "status = 'posted'", 'type = ?'];
    const params = [tenantId, type];
    if (financialPeriodId !== undefined) {
      conditions.push('financial_period_id = ?');
      params.push(financialPeriodId);
    }
    if (fundId !== undefined) {
      conditions.push('fund_id = ?');
      params.push(fundId);
    }
    if (categoryId !== undefined) {
      conditions.push('category_id = ?');
      params.push(categoryId);
    }
    const [rows] = await this.runner(connection).query(
      `SELECT CAST(COALESCE(SUM(amount), 0) AS DECIMAL(14,2)) AS total FROM transactions WHERE ${conditions.join(' AND ')}`,
      params
    );
    return rows[0].total;
  }

  async listHistory(
    tenantId,
    { accountId, fundId, financialPeriodId, status, type, direction, limit = 50, offset = 0 } = {},
    connection
  ) {
    assertTenantId(tenantId);
    const conditions = ['tenant_id = ?'];
    const params = [tenantId];
    if (accountId !== undefined) {
      conditions.push('account_id = ?');
      params.push(accountId);
    }
    if (fundId !== undefined) {
      conditions.push('fund_id = ?');
      params.push(fundId);
    }
    if (financialPeriodId !== undefined) {
      conditions.push('financial_period_id = ?');
      params.push(financialPeriodId);
    }
    if (status !== undefined) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (type !== undefined) {
      conditions.push('type = ?');
      params.push(type);
    }
    if (direction !== undefined) {
      conditions.push('direction = ?');
      params.push(direction);
    }
    const [rows] = await this.runner(connection).query(
      `SELECT * FROM transactions WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows;
  }
}

export const transactionsRepository = new TransactionsRepository();

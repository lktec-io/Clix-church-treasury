import { TenantScopedRepository } from '../../db/TenantScopedRepository.js';
import { nowSql } from '../../db/time.js';

class FinancialPeriodsRepository extends TenantScopedRepository {
  constructor() {
    super('financial_periods');
  }

  async findOpen(tenantId, connection) {
    const [rows] = await this.runner(connection).query(
      `SELECT * FROM financial_periods WHERE tenant_id = ? AND status = 'open'
       ORDER BY start_date DESC LIMIT 1`,
      [tenantId]
    );
    return rows[0] ?? null;
  }

  async create(tenantId, { label, startDate, endDate }, connection) {
    return this.insert(tenantId, { label, start_date: startDate, end_date: endDate, status: 'open' }, connection);
  }

  async close(tenantId, id, userId, connection) {
    return this.update(
      tenantId,
      id,
      { status: 'closed', closed_by_user_id: userId, closed_at: nowSql() },
      connection
    );
  }

  async reopen(tenantId, id, connection) {
    return this.update(tenantId, id, { status: 'open', reopened_at: nowSql() }, connection);
  }
}

export const financialPeriodsRepository = new FinancialPeriodsRepository();

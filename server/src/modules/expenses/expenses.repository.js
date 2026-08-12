import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';

class ExpensesRepository extends TenantScopedRepository {
  constructor() {
    super('expenses');
  }

  async search(tenantId, { status, requestedByUserId, fundId, limit = 50, offset = 0 } = {}, connection) {
    assertTenantId(tenantId);
    const conditions = ['tenant_id = ?'];
    const params = [tenantId];
    if (status !== undefined) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (requestedByUserId !== undefined) {
      conditions.push('requested_by_user_id = ?');
      params.push(requestedByUserId);
    }
    if (fundId !== undefined) {
      conditions.push('fund_id = ?');
      params.push(fundId);
    }
    const [rows] = await this.runner(connection).query(
      `SELECT * FROM expenses WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows;
  }
}

export const expensesRepository = new ExpensesRepository();

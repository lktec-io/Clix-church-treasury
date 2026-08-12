import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';

class BudgetsRepository extends TenantScopedRepository {
  constructor() {
    super('budgets');
  }

  async findByPeriodFundCategory(tenantId, financialPeriodId, fundId, categoryId, connection) {
    assertTenantId(tenantId);
    const conditions = ['tenant_id = ?', 'financial_period_id = ?', 'fund_id = ?'];
    const params = [tenantId, financialPeriodId, fundId];
    if (categoryId === null || categoryId === undefined) {
      conditions.push('category_id IS NULL');
    } else {
      conditions.push('category_id = ?');
      params.push(categoryId);
    }
    const [rows] = await this.runner(connection).query(
      `SELECT * FROM budgets WHERE ${conditions.join(' AND ')} LIMIT 1`,
      params
    );
    return rows[0] ?? null;
  }

  async search(tenantId, { financialPeriodId, fundId, status = 'active' } = {}, connection) {
    assertTenantId(tenantId);
    const conditions = ['tenant_id = ?'];
    const params = [tenantId];
    if (financialPeriodId !== undefined) {
      conditions.push('financial_period_id = ?');
      params.push(financialPeriodId);
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
      `SELECT * FROM budgets WHERE ${conditions.join(' AND ')} ORDER BY id`,
      params
    );
    return rows;
  }
}

export const budgetsRepository = new BudgetsRepository();

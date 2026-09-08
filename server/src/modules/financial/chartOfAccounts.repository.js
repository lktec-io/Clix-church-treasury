import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';
import { nowSql } from '../../db/time.js';
import { CHART_OF_ACCOUNTS_TEMPLATE, NORMAL_BALANCE_BY_TYPE } from '../../db/seeds/chartOfAccountsTemplate.js';

class ChartOfAccountsRepository extends TenantScopedRepository {
  constructor() {
    super('chart_of_accounts');
  }

  async findBySystemRole(tenantId, systemRole, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM chart_of_accounts WHERE tenant_id = ? AND system_role = ? LIMIT 1',
      [tenantId, systemRole]
    );
    return rows[0] ?? null;
  }

  async findAllActive(tenantId, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM chart_of_accounts WHERE tenant_id = ? AND is_active = TRUE ORDER BY code',
      [tenantId]
    );
    return rows;
  }

  /**
   * Seeds the standard template for a tenant. Idempotent via INSERT IGNORE
   * against uq_coa_tenant_code, so it is safe to call on an existing tenant
   * — which is what makes it usable as a lazy backfill for the churches
   * that already existed before this migration, not just at signup.
   */
  async seedTemplate(tenantId, connection) {
    assertTenantId(tenantId);
    const now = nowSql();
    const runner = this.runner(connection);
    for (const account of CHART_OF_ACCOUNTS_TEMPLATE) {
      // Sequential, not Promise.all: these share one connection inside the
      // caller's transaction, and mysql2 cannot run concurrent queries on a
      // single connection.
      await runner.query(
        `INSERT IGNORE INTO chart_of_accounts
           (tenant_id, code, name, name_sw, account_type, normal_balance, system_role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)`,
        [
          tenantId,
          account.code,
          account.name,
          account.nameSw,
          account.accountType,
          NORMAL_BALANCE_BY_TYPE[account.accountType],
          account.systemRole,
          now,
          now,
        ]
      );
    }
    return this.findAllActive(tenantId, connection);
  }

  /**
   * Trial balance: every account with its debit and credit totals.
   *
   * Grouped in SQL rather than in JS because this is an aggregate over the
   * whole journal, not the small already-fetched row sets
   * financialSummary.service.js sums in memory — a church with three years
   * of history would otherwise pull every line into the process to add it up.
   */
  async trialBalance(tenantId, { financialPeriodId } = {}, connection) {
    assertTenantId(tenantId);
    const conditions = ['coa.tenant_id = ?'];
    const params = [tenantId];
    if (financialPeriodId !== undefined && financialPeriodId !== null) {
      conditions.push('je.financial_period_id = ?');
      params.push(financialPeriodId);
    }
    const [rows] = await this.runner(connection).query(
      `SELECT coa.id, coa.code, coa.name, coa.name_sw, coa.account_type, coa.normal_balance,
              COALESCE(SUM(jl.debit), 0)  AS total_debit,
              COALESCE(SUM(jl.credit), 0) AS total_credit
         FROM chart_of_accounts coa
         LEFT JOIN journal_lines jl   ON jl.coa_account_id = coa.id AND jl.tenant_id = coa.tenant_id
         LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.tenant_id = coa.tenant_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY coa.id, coa.code, coa.name, coa.name_sw, coa.account_type, coa.normal_balance
        ORDER BY coa.code`,
      params
    );
    return rows;
  }
}

export const chartOfAccountsRepository = new ChartOfAccountsRepository();

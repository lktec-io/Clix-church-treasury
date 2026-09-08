import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';
import { nowSql } from '../../db/time.js';

class RemittanceRulesRepository extends TenantScopedRepository {
  constructor() {
    super('remittance_rules');
  }

  async findActiveByFundId(tenantId, fundId, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      "SELECT * FROM remittance_rules WHERE tenant_id = ? AND fund_id = ? AND status = 'active' LIMIT 1",
      [tenantId, fundId]
    );
    return rows[0] ?? null;
  }

  async listWithFund(tenantId, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      `SELECT r.*, f.name AS fund_name
         FROM remittance_rules r
         JOIN funds f ON f.id = r.fund_id AND f.tenant_id = r.tenant_id
        WHERE r.tenant_id = ?
        ORDER BY f.name`,
      [tenantId]
    );
    return rows;
  }
}

class RemittanceLedgersRepository extends TenantScopedRepository {
  constructor() {
    super('remittance_ledgers');
  }

  /**
   * Adds `amount` to the (period, rule) bucket, creating it on first use.
   *
   * A single atomic INSERT ... ON DUPLICATE KEY UPDATE against
   * uq_remittance_ledgers_period_rule, deliberately NOT a
   * select-then-insert-or-update: two contributions recorded at the same
   * instant would both see "no bucket" and race, and the loser would either
   * crash on the unique constraint or silently overwrite the winner's
   * accrual. The obligation to the Conference must not depend on timing.
   *
   * The arithmetic is done by MySQL on a DECIMAL column, so it never passes
   * through a JS float.
   */
  async accrue(tenantId, { financialPeriodId, ruleId, fundId, amount }, connection) {
    assertTenantId(tenantId);
    const now = nowSql();
    await this.runner(connection).query(
      `INSERT INTO remittance_ledgers
         (tenant_id, financial_period_id, rule_id, fund_id, amount_accrued, amount_paid, status_flag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0.00, 'pending_transfer', ?, ?)
       ON DUPLICATE KEY UPDATE
         amount_accrued = amount_accrued + VALUES(amount_accrued),
         -- An accrual on a bucket already marked fully remitted reopens it:
         -- more money arrived after the last payout, so more is owed.
         status_flag = CASE
           WHEN amount_paid <= 0 THEN 'pending_transfer'
           WHEN amount_paid < amount_accrued + VALUES(amount_accrued) THEN 'partially_remitted'
           ELSE 'fully_remitted'
         END,
         updated_at = VALUES(updated_at)`,
      [tenantId, financialPeriodId, ruleId, fundId, amount, now, now]
    );
    return this.findByPeriodAndRule(tenantId, financialPeriodId, ruleId, connection);
  }

  async findByPeriodAndRule(tenantId, financialPeriodId, ruleId, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM remittance_ledgers WHERE tenant_id = ? AND financial_period_id = ? AND rule_id = ? LIMIT 1',
      [tenantId, financialPeriodId, ruleId]
    );
    return rows[0] ?? null;
  }

  /** Records a payout against a bucket and re-derives its status flag. */
  async recordPayment(tenantId, ledgerId, amount, connection) {
    assertTenantId(tenantId);
    await this.runner(connection).query(
      `UPDATE remittance_ledgers
          SET amount_paid = amount_paid + ?,
              status_flag = CASE
                WHEN amount_paid + ? >= amount_accrued THEN 'fully_remitted'
                WHEN amount_paid + ? > 0 THEN 'partially_remitted'
                ELSE 'pending_transfer'
              END,
              updated_at = ?
        WHERE tenant_id = ? AND id = ?`,
      [amount, amount, amount, nowSql(), tenantId, ledgerId]
    );
    return this.findById(tenantId, ledgerId, connection);
  }

  /**
   * The remittance hub's data: every bucket with the fund and body it
   * belongs to. Joined here rather than assembled in the service so the
   * page is one query, not one per row.
   */
  async listDetailed(tenantId, { financialPeriodId } = {}, connection) {
    assertTenantId(tenantId);
    const conditions = ['l.tenant_id = ?'];
    const params = [tenantId];
    if (financialPeriodId !== undefined && financialPeriodId !== null) {
      conditions.push('l.financial_period_id = ?');
      params.push(financialPeriodId);
    }
    const [rows] = await this.runner(connection).query(
      `SELECT l.*, f.name AS fund_name, r.higher_body_name, r.percentage_to_remit,
              p.label AS period_label, p.status AS period_status
         FROM remittance_ledgers l
         JOIN remittance_rules r    ON r.id = l.rule_id AND r.tenant_id = l.tenant_id
         JOIN funds f               ON f.id = l.fund_id AND f.tenant_id = l.tenant_id
         JOIN financial_periods p   ON p.id = l.financial_period_id AND p.tenant_id = l.tenant_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.start_date DESC, f.name`,
      params
    );
    return rows;
  }
}

export const remittanceRulesRepository = new RemittanceRulesRepository();
export const remittanceLedgersRepository = new RemittanceLedgersRepository();

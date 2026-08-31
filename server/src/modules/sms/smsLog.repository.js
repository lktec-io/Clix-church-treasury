import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';

class SmsLogRepository extends TenantScopedRepository {
  constructor() {
    super('sms_log');
  }

  // Aggregate health snapshot for GET /sms/status (sms.controller.js) — an
  // admin needs more than "is a key present" to know whether SMS is
  // actually working: how many sends have succeeded/failed, and what the
  // most recent failure's reason was, without granting log-table access.
  async getStats(tenantId, connection) {
    assertTenantId(tenantId);
    const runner = this.runner(connection);
    const [[counts]] = await runner.query(
      `SELECT
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS successfulSends,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedSends
       FROM sms_log
       WHERE tenant_id = ?`,
      [tenantId]
    );
    const [lastFailureRows] = await runner.query(
      `SELECT reason_code, created_at
       FROM sms_log
       WHERE tenant_id = ? AND status = 'failed'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [tenantId]
    );
    const lastFailure = lastFailureRows[0] ?? null;
    return {
      successfulSends: Number(counts?.successfulSends ?? 0),
      failedSends: Number(counts?.failedSends ?? 0),
      lastErrorCategory: lastFailure?.reason_code ?? null,
      lastFailureAt: lastFailure?.created_at ?? null,
    };
  }
}

export const smsLogRepository = new SmsLogRepository();

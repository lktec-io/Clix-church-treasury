import { pool } from '../../config/db.js';
import { nowSql } from '../../db/time.js';

class AuditLogRepository {
  runner(connection) {
    return connection ?? pool;
  }

  async insert(
    { tenantId = null, actorUserId = null, action, entityType = null, entityId = null, before = null, after = null, ipAddress = null },
    connection
  ) {
    await this.runner(connection).query(
      `INSERT INTO audit_logs
        (tenant_id, actor_user_id, action, entity_type, entity_id, before_state, after_state, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, actorUserId, action, entityType, entityId, before, after, ipAddress, nowSql()]
    );
  }

  async listForTenant(tenantId, { limit = 100 } = {}, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      [tenantId, limit]
    );
    return rows;
  }
}

export const auditLogRepository = new AuditLogRepository();

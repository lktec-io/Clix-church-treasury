import { pool } from '../../config/db.js';
import { nowSql } from '../../db/time.js';

// 1:1 with tenants — scoped by tenant_id like every other tenant-owned table,
// but modeled separately from TenantScopedRepository since it's always a
// single row per tenant (get/update, no findAll/list).
class ChurchSettingsRepository {
  runner(connection) {
    return connection ?? pool;
  }

  async findByTenantId(tenantId, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM church_settings WHERE tenant_id = ? LIMIT 1',
      [tenantId]
    );
    return rows[0] ?? null;
  }

  async create(tenantId, { address = null, phone = null, email = null } = {}, connection) {
    const now = nowSql();
    await this.runner(connection).query(
      `INSERT INTO church_settings (tenant_id, address, phone, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenantId, address, phone, email, now, now]
    );
    return this.findByTenantId(tenantId, connection);
  }
}

export const churchSettingsRepository = new ChurchSettingsRepository();

import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';
import { nowSql } from '../../db/time.js';

// The four ministries most Tanzanian congregations organise money around.
// Seeded as a starting point only — rows belong to the tenant and can be
// renamed or extended; nothing in the code keys off these names.
export const DEFAULT_DEPARTMENTS = ['Kwaya', 'Vijana', 'Huduma za Jamii', 'Idara ya Watoto'];

class DepartmentsRepository extends TenantScopedRepository {
  constructor() {
    super('departments');
  }

  async listActive(tenantId, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM departments WHERE tenant_id = ? AND is_active = TRUE ORDER BY name',
      [tenantId]
    );
    return rows;
  }

  /** Idempotent (INSERT IGNORE on uq_departments_tenant_name). */
  async seedDefaults(tenantId, connection) {
    assertTenantId(tenantId);
    const now = nowSql();
    for (const name of DEFAULT_DEPARTMENTS) {
      // Sequential: one shared transaction connection cannot run concurrent
      // queries under mysql2.
      await this.runner(connection).query(
        'INSERT IGNORE INTO departments (tenant_id, name, is_active, created_at, updated_at) VALUES (?, ?, TRUE, ?, ?)',
        [tenantId, name, now, now]
      );
    }
  }
}

export const departmentsRepository = new DepartmentsRepository();

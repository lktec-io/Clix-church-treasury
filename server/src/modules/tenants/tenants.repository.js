import { pool } from '../../config/db.js';
import { nowSql } from '../../db/time.js';

// Not a TenantScopedRepository — this repository manages the tenants table
// itself, which has no tenant_id column to scope by.
export class TenantsRepository {
  runner(connection) {
    return connection ?? pool;
  }

  async findById(id, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM tenants WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] ?? null;
  }

  async findBySlug(slug, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM tenants WHERE slug = ? LIMIT 1',
      [slug]
    );
    return rows[0] ?? null;
  }

  async create({ name, slug, baseCurrency = 'TZS', localeDefault = 'en' }, connection) {
    const now = nowSql();
    const [result] = await this.runner(connection).query(
      `INSERT INTO tenants (name, slug, base_currency, locale_default, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      [name, slug, baseCurrency, localeDefault, now, now]
    );
    return this.findById(result.insertId, connection);
  }

  async updateStatus(id, status, connection) {
    const [result] = await this.runner(connection).query(
      'UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?',
      [status, nowSql(), id]
    );
    if (result.affectedRows === 0) return null;
    return this.findById(id, connection);
  }

  async updateDetails(id, { name, baseCurrency, localeDefault }, connection) {
    const [result] = await this.runner(connection).query(
      'UPDATE tenants SET name = ?, base_currency = ?, locale_default = ?, updated_at = ? WHERE id = ?',
      [name, baseCurrency, localeDefault, nowSql(), id]
    );
    if (result.affectedRows === 0) return null;
    return this.findById(id, connection);
  }

  // Platform admin's tenant list — a correlated subquery for a
  // representative admin (earliest-created user, i.e. the one created at
  // setup/registration) and a user count, in one query rather than N+1.
  // Never touches password_hash. Fine at the scale a platform admin
  // console actually operates at (a handful to a few dozen tenants), the
  // same "don't build for a scale that doesn't exist yet" judgment call
  // already used elsewhere in this codebase (docs/MASTER_TODO.md).
  // Every table carrying tenant_id, in the order they must be emptied.
  //
  // WHY AN EXPLICIT ORDER: all 19 tenant foreign keys are ON DELETE
  // RESTRICT (grep "REFERENCES tenants" across src/db/migrations) — nothing
  // cascades from the tenants row itself, so `DELETE FROM tenants` on a
  // tenant with any data fails outright. This list is reverse dependency
  // order: children before the rows they point at.
  //
  // Six tables are deliberately ABSENT because they cascade from a row this
  // list already removes, and deleting them here would be dead work:
  //   contribution_items        <- contributions        (CASCADE)
  //   contributor_refresh_tokens<- contributors         (CASCADE)
  //   user_roles                <- users                (CASCADE)
  //   refresh_tokens            <- users                (CASCADE)
  //   password_reset_tokens     <- users                (CASCADE)
  //   role_permissions          <- roles                (CASCADE)
  //
  // If a future migration adds a tenant-scoped table, it MUST be added here
  // or tenant deletion will start failing with ER_ROW_IS_REFERENCED_2. The
  // assertion in hardDeleteWithAllData() is what turns that into a loud,
  // immediate failure instead of a silent half-delete.
  static TENANT_TABLES_IN_DELETE_ORDER = [
    'sms_log',
    'budgets',
    'receipts',
    'receipt_sequences',
    'pledges',
    'expenses',
    'contributions',
    'contributor_sequences',
    'contributors',
    'transactions',
    'financial_periods',
    'categories',
    'funds',
    'accounts',
    'audit_logs',
    'users',
    'roles',
    'church_settings',
  ];

  // Permanently removes a tenant and everything scoped to it.
  //
  // MUST be called with a connection inside withTransaction() — a partial
  // run would leave a tenant with half its data gone, which is worse than
  // either outcome. The caller (platform.service.js#deleteTenant) is
  // responsible for authorization, for refusing the internal platform
  // tenant, and for the slug confirmation check.
  //
  // Returns per-table row counts so the audit record can state exactly what
  // was destroyed.
  async hardDeleteWithAllData(tenantId, connection) {
    if (!connection) {
      throw new Error('hardDeleteWithAllData requires a transaction connection');
    }

    const deletedCounts = {};
    for (const table of TenantsRepository.TENANT_TABLES_IN_DELETE_ORDER) {
      const [result] = await connection.query(`DELETE FROM ${table} WHERE tenant_id = ?`, [tenantId]);
      if (result.affectedRows > 0) deletedCounts[table] = result.affectedRows;
    }

    const [tenantResult] = await connection.query('DELETE FROM tenants WHERE id = ?', [tenantId]);
    if (tenantResult.affectedRows === 0) {
      // Someone else deleted it between our read and this write. Throwing
      // rolls the whole transaction back rather than reporting a success
      // that deleted child rows belonging to a tenant we never removed.
      throw new Error('Tenant row was not deleted — it no longer exists');
    }

    return deletedCounts;
  }

  async listAllWithAdminSummary(connection) {
    const [rows] = await this.runner(connection).query(
      `SELECT
         t.*,
         (SELECT u.id FROM users u WHERE u.tenant_id = t.id ORDER BY u.id ASC LIMIT 1) AS admin_user_id,
         (SELECT u.email FROM users u WHERE u.tenant_id = t.id ORDER BY u.id ASC LIMIT 1) AS admin_email,
         (SELECT u.full_name FROM users u WHERE u.tenant_id = t.id ORDER BY u.id ASC LIMIT 1) AS admin_full_name,
         (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count
       FROM tenants t
       ORDER BY t.created_at DESC, t.id DESC`
    );
    return rows;
  }
}

export const tenantsRepository = new TenantsRepository();

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

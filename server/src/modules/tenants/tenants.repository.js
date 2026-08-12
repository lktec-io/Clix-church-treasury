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
}

export const tenantsRepository = new TenantsRepository();

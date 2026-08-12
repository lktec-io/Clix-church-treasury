import { pool } from '../config/db.js';
import { nowSql } from './time.js';

export function assertTenantId(tenantId) {
  if (tenantId === undefined || tenantId === null || tenantId === '') {
    throw new TypeError('tenantId is required for tenant-scoped repository operations');
  }
}

/**
 * Base for every repository touching a tenant-owned table. Every method takes
 * tenantId as its first argument and every query includes `WHERE tenant_id = ?`
 * — there is deliberately no unscoped convenience method (SECURITY_ARCHITECTURE.md §1).
 *
 * `this.table` is always a hardcoded string set by the subclass constructor
 * (never request-derived), so interpolating it directly into SQL is safe.
 * `data`/`updates` objects passed to insert()/update() must be built by
 * repository/service code from an explicit set of known column names —
 * never by spreading a raw, unvalidated request body — since their keys are
 * used as SQL identifiers.
 */
export class TenantScopedRepository {
  constructor(table) {
    this.table = table;
  }

  runner(connection) {
    return connection ?? pool;
  }

  async findById(tenantId, id, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      `SELECT * FROM ${this.table} WHERE tenant_id = ? AND id = ? LIMIT 1`,
      [tenantId, id]
    );
    return rows[0] ?? null;
  }

  async findAllByTenant(tenantId, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      `SELECT * FROM ${this.table} WHERE tenant_id = ? ORDER BY id`,
      [tenantId]
    );
    return rows;
  }

  async existsById(tenantId, id, connection) {
    const row = await this.findById(tenantId, id, connection);
    return row !== null;
  }

  async insert(tenantId, data, connection) {
    assertTenantId(tenantId);
    const now = nowSql();
    const payload = { tenant_id: tenantId, created_at: now, updated_at: now, ...data };
    const columns = Object.keys(payload);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map((c) => payload[c]);
    const [result] = await this.runner(connection).query(
      `INSERT INTO ${this.table} (${columns.join(', ')}) VALUES (${placeholders})`,
      values
    );
    return this.findById(tenantId, result.insertId, connection);
  }

  async update(tenantId, id, updates, connection) {
    assertTenantId(tenantId);
    const payload = { ...updates, updated_at: nowSql() };
    const columns = Object.keys(payload);
    const setClause = columns.map((c) => `${c} = ?`).join(', ');
    const values = [...columns.map((c) => payload[c]), tenantId, id];
    const [result] = await this.runner(connection).query(
      `UPDATE ${this.table} SET ${setClause} WHERE tenant_id = ? AND id = ?`,
      values
    );
    if (result.affectedRows === 0) return null;
    return this.findById(tenantId, id, connection);
  }
}

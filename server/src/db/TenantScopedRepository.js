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

  /**
   * Reads one row and holds a write lock on it until the caller's
   * transaction ends.
   *
   * For any "check the state, then act on it" sequence where acting twice
   * would be a financial error — paying an approved expense, taking a
   * payment against a pledge. Without the lock two concurrent requests both
   * read the old state and both proceed: two ledger postings for one
   * expense, or two payments that together exceed a pledge.
   *
   * A connection is REQUIRED: a lock outside a transaction is released
   * immediately and protects nothing, so passing none is a programming
   * error rather than a silently weaker guarantee.
   */
  async findByIdForUpdate(tenantId, id, connection) {
    assertTenantId(tenantId);
    if (!connection) {
      throw new Error(`${this.table}.findByIdForUpdate requires a transaction connection`);
    }
    const [rows] = await connection.query(
      `SELECT * FROM ${this.table} WHERE tenant_id = ? AND id = ? FOR UPDATE`,
      [tenantId, id]
    );
    return rows[0] ?? null;
  }

  /**
   * Updates a row only while a column still holds an expected value, in one
   * atomic statement. Returns the updated row, or null when the row no
   * longer matched — which the caller should report as a conflict.
   *
   * The lock-free alternative to findByIdForUpdate for transitions with no
   * financial effect (draft → submitted, submitted → approved): whichever
   * request arrives second changes nothing and is told why.
   */
  async updateWhere(tenantId, id, expected, updates, connection) {
    assertTenantId(tenantId);
    const payload = { ...updates, updated_at: nowSql() };
    const setColumns = Object.keys(payload);
    const whereColumns = Object.keys(expected);
    const values = [
      ...setColumns.map((c) => payload[c]),
      tenantId,
      id,
      ...whereColumns.map((c) => expected[c]),
    ];
    const [result] = await this.runner(connection).query(
      `UPDATE ${this.table} SET ${setColumns.map((c) => `${c} = ?`).join(', ')}
        WHERE tenant_id = ? AND id = ? AND ${whereColumns.map((c) => `${c} = ?`).join(' AND ')}`,
      values
    );
    if (result.affectedRows === 0) return null;
    return this.findById(tenantId, id, connection);
  }

  /**
   * Permanently removes one row belonging to this tenant. Returns true when
   * a row was deleted, false when the id did not exist for this tenant.
   *
   * Deliberately plain: the decision about whether a row MAY be destroyed —
   * whether it carries financial history, whether the actor is allowed to —
   * belongs in the service layer, where the domain rules and the audit log
   * live. The database's own foreign keys remain the final backstop; a row
   * still referenced by a ledger entry cannot be deleted here at all.
   */
  async deleteById(tenantId, id, connection) {
    assertTenantId(tenantId);
    const [result] = await this.runner(connection).query(
      `DELETE FROM ${this.table} WHERE tenant_id = ? AND id = ?`,
      [tenantId, id]
    );
    return result.affectedRows > 0;
  }
}

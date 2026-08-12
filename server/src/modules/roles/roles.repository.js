import { pool } from '../../config/db.js';
import { nowSql } from '../../db/time.js';

// Roles has a nullable tenant_id (NULL = system-default role shared by every
// tenant), so it doesn't fit TenantScopedRepository's "tenant_id is always
// required" assumption — every method here is explicit about which rows it touches.
class RolesRepository {
  runner(connection) {
    return connection ?? pool;
  }

  async findSystemRoleByName(name, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM roles WHERE tenant_id IS NULL AND name = ? LIMIT 1',
      [name]
    );
    return rows[0] ?? null;
  }

  async findById(id, connection) {
    const [rows] = await this.runner(connection).query('SELECT * FROM roles WHERE id = ? LIMIT 1', [id]);
    return rows[0] ?? null;
  }

  // Roles visible to a tenant = its own custom roles + every system-default role.
  async listForTenant(tenantId, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM roles WHERE tenant_id = ? OR tenant_id IS NULL ORDER BY tenant_id IS NULL DESC, name',
      [tenantId]
    );
    return rows;
  }

  async createSystemRole({ name, description }, connection) {
    const now = nowSql();
    const [result] = await this.runner(connection).query(
      `INSERT INTO roles (tenant_id, name, description, is_system, created_at, updated_at)
       VALUES (NULL, ?, ?, TRUE, ?, ?)`,
      [name, description ?? null, now, now]
    );
    return this.findById(result.insertId, connection);
  }

  async createTenantRole(tenantId, { name, description }, connection) {
    const now = nowSql();
    const [result] = await this.runner(connection).query(
      `INSERT INTO roles (tenant_id, name, description, is_system, created_at, updated_at)
       VALUES (?, ?, ?, FALSE, ?, ?)`,
      [tenantId, name, description ?? null, now, now]
    );
    return this.findById(result.insertId, connection);
  }
}

export const rolesRepository = new RolesRepository();

import { pool } from '../../config/db.js';
import { nowSql } from '../../db/time.js';

// Global, not tenant-scoped — see docs/DATABASE_ARCHITECTURE.md §2.
class PermissionsRepository {
  runner(connection) {
    return connection ?? pool;
  }

  async findByName(name, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM permissions WHERE name = ? LIMIT 1',
      [name]
    );
    return rows[0] ?? null;
  }

  async listAll(connection) {
    const [rows] = await this.runner(connection).query('SELECT * FROM permissions ORDER BY name');
    return rows;
  }

  async create({ name, description }, connection) {
    const now = nowSql();
    const [result] = await this.runner(connection).query(
      'INSERT INTO permissions (name, description, created_at) VALUES (?, ?, ?)',
      [name, description ?? null, now]
    );
    const [rows] = await this.runner(connection).query('SELECT * FROM permissions WHERE id = ?', [
      result.insertId,
    ]);
    return rows[0];
  }

  async grantToRole(roleId, permissionId, connection) {
    await this.runner(connection).query(
      'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
      [roleId, permissionId]
    );
  }

  async listForRole(roleId, connection) {
    const [rows] = await this.runner(connection).query(
      `SELECT p.* FROM permissions p
       INNER JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ?
       ORDER BY p.name`,
      [roleId]
    );
    return rows;
  }

  // Effective permission names for a user, across all roles held, tenant-agnostic
  // by design — role_id already fixes which tenant a custom role belongs to, and
  // user_roles only ever links a user to roles within their own tenant (enforced
  // at the service layer that assigns roles, not by this query).
  async listForUser(userId, connection) {
    const [rows] = await this.runner(connection).query(
      `SELECT DISTINCT p.name FROM permissions p
       INNER JOIN role_permissions rp ON rp.permission_id = p.id
       INNER JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = ?`,
      [userId]
    );
    return rows.map((r) => r.name);
  }
}

export const permissionsRepository = new PermissionsRepository();

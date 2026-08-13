import { pool } from '../../config/db.js';

// user_roles has no tenant_id of its own — both user_id and role_id are
// validated as belonging to the correct tenant by the calling service
// before any of these run (see users.service.js / auth.service.js).
class UserRolesRepository {
  runner(connection) {
    return connection ?? pool;
  }

  async assign(userId, roleId, connection) {
    await this.runner(connection).query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [
      userId,
      roleId,
    ]);
  }

  async remove(userId, roleId, connection) {
    await this.runner(connection).query('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', [
      userId,
      roleId,
    ]);
  }

  async listRoleIdsForUser(userId, connection) {
    const [rows] = await this.runner(connection).query('SELECT role_id FROM user_roles WHERE user_id = ?', [
      userId,
    ]);
    return rows.map((r) => r.role_id);
  }

  // One query for the whole Users admin list, not one per row — avoids an
  // N+1 (docs/MASTER_TODO.md Phase 9/12: "avoid N+1 database queries").
  async listRolesForUsers(userIds, connection) {
    if (userIds.length === 0) return [];
    const placeholders = userIds.map(() => '?').join(', ');
    const [rows] = await this.runner(connection).query(
      `SELECT ur.user_id, r.id AS role_id, r.name AS role_name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id IN (${placeholders})`,
      userIds
    );
    return rows;
  }
}

export const userRolesRepository = new UserRolesRepository();

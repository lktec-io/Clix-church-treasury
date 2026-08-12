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
}

export const userRolesRepository = new UserRolesRepository();

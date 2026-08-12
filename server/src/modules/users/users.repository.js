import { pool } from '../../config/db.js';
import { nowSql } from '../../db/time.js';
import { TenantScopedRepository } from '../../db/TenantScopedRepository.js';

class UsersRepository extends TenantScopedRepository {
  constructor() {
    super('users');
  }

  async findByEmail(tenantId, email, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM users WHERE tenant_id = ? AND email = ? LIMIT 1',
      [tenantId, email]
    );
    return rows[0] ?? null;
  }

  // The one deliberate exception to "every lookup is tenant-scoped": the
  // refresh-token flow only has a user_id (from the token record) to start
  // from and must discover that user's tenant itself — the tenant_id it
  // returns comes from the server-side row, never from client input, so this
  // does not weaken tenant isolation (SECURITY_ARCHITECTURE.md §1).
  async findByIdAnyTenant(id, connection) {
    const [rows] = await this.runner(connection ?? pool).query(
      'SELECT * FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] ?? null;
  }

  async create(tenantId, { email, passwordHash, fullName, status = 'invited' }, connection) {
    return this.insert(
      tenantId,
      { email, password_hash: passwordHash, full_name: fullName, status },
      connection
    );
  }

  async recordFailedLogin(tenantId, userId, { attempts, lockedUntil }, connection) {
    return this.update(
      tenantId,
      userId,
      { failed_login_attempts: attempts, locked_until: lockedUntil },
      connection
    );
  }

  async recordSuccessfulLogin(tenantId, userId, connection) {
    return this.update(
      tenantId,
      userId,
      { failed_login_attempts: 0, locked_until: null, last_login_at: nowSql() },
      connection
    );
  }

  async setPasswordHash(tenantId, userId, passwordHash, connection) {
    return this.update(tenantId, userId, { password_hash: passwordHash }, connection);
  }

  async setStatus(tenantId, userId, status, connection) {
    return this.update(tenantId, userId, { status }, connection);
  }
}

export const usersRepository = new UsersRepository();

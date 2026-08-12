import { pool } from '../../config/db.js';
import { nowSql } from '../../db/time.js';

// Scoped by user_id, not tenant_id directly — the caller resolves and
// validates the tenant via the user record before touching this table.
class PasswordResetTokensRepository {
  runner(connection) {
    return connection ?? pool;
  }

  async create(userId, tokenHash, expiresAt, connection) {
    await this.runner(connection).query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`,
      [userId, tokenHash, expiresAt, nowSql()]
    );
  }

  async findByHash(tokenHash, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM password_reset_tokens WHERE token_hash = ? LIMIT 1',
      [tokenHash]
    );
    return rows[0] ?? null;
  }

  async markUsed(id, connection) {
    await this.runner(connection).query('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?', [
      nowSql(),
      id,
    ]);
  }
}

export const passwordResetTokensRepository = new PasswordResetTokensRepository();

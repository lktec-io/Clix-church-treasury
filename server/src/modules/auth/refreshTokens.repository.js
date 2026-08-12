import { pool } from '../../config/db.js';
import { nowSql } from '../../db/time.js';

class RefreshTokensRepository {
  runner(connection) {
    return connection ?? pool;
  }

  async create(userId, tokenHash, expiresAt, connection) {
    const [result] = await this.runner(connection).query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
      [userId, tokenHash, expiresAt, nowSql()]
    );
    return result.insertId;
  }

  async findByHash(tokenHash, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM refresh_tokens WHERE token_hash = ? LIMIT 1',
      [tokenHash]
    );
    return rows[0] ?? null;
  }

  async revoke(id, connection) {
    await this.runner(connection).query('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?', [
      nowSql(),
      id,
    ]);
  }

  async setReplacement(id, replacedByTokenId, connection) {
    await this.runner(connection).query(
      'UPDATE refresh_tokens SET replaced_by_token_id = ? WHERE id = ?',
      [replacedByTokenId, id]
    );
  }

  // Reuse-detection sweep: walk the replacement chain forward from a revoked
  // token and revoke every descendant too, since presenting an already-used
  // token is a signal the token was stolen after rotation (SECURITY_ARCHITECTURE.md §2).
  async revokeChainFrom(tokenId, connection) {
    let currentId = tokenId;
    const runner = this.runner(connection);
    while (currentId) {
      const [rows] = await runner.query(
        'SELECT id, replaced_by_token_id FROM refresh_tokens WHERE id = ?',
        [currentId]
      );
      if (rows.length === 0) break;
      await runner.query('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?', [
        nowSql(),
        currentId,
      ]);
      currentId = rows[0].replaced_by_token_id;
    }
  }

  async revokeAllForUser(userId, connection) {
    await this.runner(connection).query(
      'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      [nowSql(), userId]
    );
  }
}

export const refreshTokensRepository = new RefreshTokensRepository();

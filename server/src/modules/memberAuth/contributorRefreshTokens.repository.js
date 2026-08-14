import { pool } from '../../config/db.js';
import { nowSql } from '../../db/time.js';

// Mirrors auth/refreshTokens.repository.js exactly (same rotation +
// reuse-detection design, SECURITY_ARCHITECTURE.md §2), targeting
// contributor_refresh_tokens instead of refresh_tokens. Not a
// TenantScopedRepository for the same reason the staff one isn't: tokens
// are looked up by hash alone, before any tenant context exists.
class ContributorRefreshTokensRepository {
  runner(connection) {
    return connection ?? pool;
  }

  async create(contributorId, tokenHash, expiresAt, connection) {
    const [result] = await this.runner(connection).query(
      `INSERT INTO contributor_refresh_tokens (contributor_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
      [contributorId, tokenHash, expiresAt, nowSql()]
    );
    return result.insertId;
  }

  async findByHash(tokenHash, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM contributor_refresh_tokens WHERE token_hash = ? LIMIT 1',
      [tokenHash]
    );
    return rows[0] ?? null;
  }

  async revoke(id, connection) {
    await this.runner(connection).query('UPDATE contributor_refresh_tokens SET revoked_at = ? WHERE id = ?', [
      nowSql(),
      id,
    ]);
  }

  async setReplacement(id, replacedByTokenId, connection) {
    await this.runner(connection).query(
      'UPDATE contributor_refresh_tokens SET replaced_by_token_id = ? WHERE id = ?',
      [replacedByTokenId, id]
    );
  }

  async revokeChainFrom(tokenId, connection) {
    let currentId = tokenId;
    const runner = this.runner(connection);
    while (currentId) {
      const [rows] = await runner.query(
        'SELECT id, replaced_by_token_id FROM contributor_refresh_tokens WHERE id = ?',
        [currentId]
      );
      if (rows.length === 0) break;
      await runner.query(
        'UPDATE contributor_refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?',
        [nowSql(), currentId]
      );
      currentId = rows[0].replaced_by_token_id;
    }
  }

  async revokeAllForContributor(contributorId, connection) {
    await this.runner(connection).query(
      'UPDATE contributor_refresh_tokens SET revoked_at = ? WHERE contributor_id = ? AND revoked_at IS NULL',
      [nowSql(), contributorId]
    );
  }
}

export const contributorRefreshTokensRepository = new ContributorRefreshTokensRepository();

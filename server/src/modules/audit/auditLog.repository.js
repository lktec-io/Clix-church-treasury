import { pool } from '../../config/db.js';
import { nowSql } from '../../db/time.js';

// Never let one of these key names reach audit_logs, even redacted-in — a
// caller passing a raw domain object (e.g. a user row) should not be able
// to leak a credential into an append-only, widely-readable log just by
// forgetting to hand-pick fields. Matched case-insensitively and as a
// substring, so `passwordHash`, `password_hash`, `newPassword`,
// `refreshToken`, `devInviteToken`, `dbPassword`, etc. are all caught by
// one rule instead of an exhaustive, easily-outdated list.
const SENSITIVE_KEY_RE = /password|token|secret|jwt|hash|apikey|api_key|credential/i;
const REDACTED = '[REDACTED]';

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}

// The one place a JS value becomes the text MySQL's JSON column type will
// actually accept — every recordAuditLog() caller in the codebase passes
// before/after as a plain object, and mysql2 does not auto-JSON-encode
// plain objects bound as query params (it falls back to `String(value)`,
// producing the literal text "[object Object]", which MySQL correctly
// rejects with ER_INVALID_JSON_TEXT). Centralized here — the repository's
// insert() — rather than patched into each of the dozen call sites, since
// this is exactly the kind of cross-cutting concern one funnel point
// exists to fix once.
export function serializeAuditState(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    // Already text — pass it through unchanged if it's already valid JSON
    // (never double-encode a caller that did its own JSON.stringify), or
    // wrap it as a JSON string literal if it's plain text, so a JSON
    // column never receives non-JSON text either way.
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(redact(value));
}

class AuditLogRepository {
  runner(connection) {
    return connection ?? pool;
  }

  async insert(
    { tenantId = null, actorUserId = null, action, entityType = null, entityId = null, before = null, after = null, ipAddress = null },
    connection
  ) {
    await this.runner(connection).query(
      `INSERT INTO audit_logs
        (tenant_id, actor_user_id, action, entity_type, entity_id, before_state, after_state, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        actorUserId,
        action,
        entityType,
        entityId,
        serializeAuditState(before),
        serializeAuditState(after),
        ipAddress,
        nowSql(),
      ]
    );
  }

  async listForTenant(tenantId, { limit = 100 } = {}, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      [tenantId, limit]
    );
    return rows;
  }
}

export const auditLogRepository = new AuditLogRepository();

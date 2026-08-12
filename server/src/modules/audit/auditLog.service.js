import { auditLogRepository } from './auditLog.repository.js';

// The single hook every module writes financial/security-relevant events
// through — see docs/SECURITY_ARCHITECTURE.md §7. Never write directly to
// audit_logs from a controller/service.
export async function recordAuditLog(entry, connection) {
  await auditLogRepository.insert(entry, connection);
}

export async function listAuditLog(tenantId, options) {
  return auditLogRepository.listForTenant(tenantId, options);
}

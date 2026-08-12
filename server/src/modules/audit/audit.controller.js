import { listAuditLog } from './auditLog.service.js';

export async function list(req, res, next) {
  try {
    const logs = await listAuditLog(req.tenantId);
    res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
}

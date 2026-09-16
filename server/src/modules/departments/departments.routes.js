import { Router } from 'express';
import { departmentsRepository } from './departments.repository.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validationError, conflict } from '../../errors/AppError.js';
import { recordAuditLog } from '../audit/auditLog.service.js';
import { withSchemaFallback } from '../../db/schemaGuard.js';

// Departments are reference data of the same class as categories, so they
// reuse the same gates rather than adding permissions that would need an
// RBAC re-seed: reading on dashboard.view (every role — the contribution
// form needs the list), changing on categories.manage.
export function departmentsRoutes() {
  const router = Router();

  router.get('/', requirePermission('dashboard.view'), async (req, res, next) => {
    try {
      // An empty list rather than a 500 on a server where migration 0038 is
      // still pending: the contribution form treats "no departments" as
      // "department is optional", which is the correct degraded behaviour.
      const data = await withSchemaFallback('departments.list', () => departmentsRepository.listActive(req.tenantId), []);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('categories.manage'), async (req, res, next) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name || name.length > 120) {
        throw validationError('Invalid department', { name: 'a name of 1–120 characters is required' });
      }
      let department;
      try {
        department = await departmentsRepository.insert(req.tenantId, { name, is_active: true });
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw conflict(`A department named "${name}" already exists`);
        throw error;
      }
      await recordAuditLog({
        tenantId: req.tenantId,
        actorUserId: req.auth.userId,
        action: 'department.created',
        entityType: 'departments',
        entityId: department.id,
        after: { name },
      });
      res.status(201).json({ success: true, data: department });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

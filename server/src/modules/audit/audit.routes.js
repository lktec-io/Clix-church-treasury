import { Router } from 'express';
import * as auditController from './audit.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function auditRoutes() {
  const router = Router();
  router.get('/', requirePermission('audit.view'), auditController.list);
  return router;
}

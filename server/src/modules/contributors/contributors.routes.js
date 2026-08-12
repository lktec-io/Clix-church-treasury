import { Router } from 'express';
import * as contributorsController from './contributors.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function contributorsRoutes() {
  const router = Router();
  router.get('/', requirePermission('contributors.view'), contributorsController.list);
  router.post('/', requirePermission('contributors.manage'), contributorsController.create);
  router.get('/:id', requirePermission('contributors.view'), contributorsController.get);
  return router;
}

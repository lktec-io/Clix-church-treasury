import { Router } from 'express';
import * as budgetsController from './budgets.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function budgetsRoutes() {
  const router = Router();
  router.get('/', requirePermission('budget.view'), budgetsController.list);
  router.post('/', requirePermission('budget.manage'), budgetsController.create);
  router.post('/:id/archive', requirePermission('budget.manage'), budgetsController.archive);
  return router;
}

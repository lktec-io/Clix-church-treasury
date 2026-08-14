import { Router } from 'express';
import * as categoriesController from './categories.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

// Category names ("Tithe", "Electricity") aren't sensitive on their own —
// gated on dashboard.view, the one permission every role holds, rather than
// a narrower income.view/expense.view that would wrongly block e.g. an
// Approver (who has expense.view but not income.view) from seeing the
// category on an expense they're reviewing. Only mutation is gated by the
// dedicated categories.manage permission.
export function categoriesRoutes() {
  const router = Router();
  router.get('/', requirePermission('dashboard.view'), categoriesController.list);
  router.post('/', requirePermission('categories.manage'), categoriesController.create);
  router.get('/:id', requirePermission('dashboard.view'), categoriesController.get);
  router.patch('/:id', requirePermission('categories.manage'), categoriesController.update);
  return router;
}

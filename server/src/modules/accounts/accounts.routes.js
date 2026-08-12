import { Router } from 'express';
import * as accountsController from './accounts.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function accountsRoutes() {
  const router = Router();
  router.get('/', requirePermission('accounts.view'), accountsController.list);
  router.post('/', requirePermission('accounts.manage'), accountsController.create);
  router.get('/:id', requirePermission('accounts.view'), accountsController.get);
  router.patch('/:id', requirePermission('accounts.manage'), accountsController.rename);
  router.post('/:id/deactivate', requirePermission('accounts.manage'), accountsController.deactivate);
  router.post('/:id/activate', requirePermission('accounts.manage'), accountsController.activate);
  return router;
}

import { Router } from 'express';
import * as transfersController from './transfers.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function transfersRoutes() {
  const router = Router();
  router.get('/', requirePermission('accounts.view'), transfersController.list);
  router.post('/', requirePermission('transfers.create'), transfersController.create);
  router.get('/:id', requirePermission('accounts.view'), transfersController.get);
  return router;
}

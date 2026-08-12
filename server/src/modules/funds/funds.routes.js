import { Router } from 'express';
import * as fundsController from './funds.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function fundsRoutes() {
  const router = Router();
  router.get('/', requirePermission('funds.view'), fundsController.list);
  router.post('/', requirePermission('funds.manage'), fundsController.create);
  router.get('/:id', requirePermission('funds.view'), fundsController.get);
  router.patch('/:id', requirePermission('funds.manage'), fundsController.rename);
  router.post('/:id/deactivate', requirePermission('funds.manage'), fundsController.deactivate);
  router.post('/:id/activate', requirePermission('funds.manage'), fundsController.activate);
  return router;
}

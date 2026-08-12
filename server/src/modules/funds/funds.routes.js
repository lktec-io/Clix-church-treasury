import { Router } from 'express';
import * as fundsController from './funds.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function fundsRoutes() {
  const router = Router();
  router.get('/', requirePermission('funds.view'), fundsController.list);
  router.post('/', requirePermission('funds.manage'), fundsController.create);
  router.get('/:id', requirePermission('funds.view'), fundsController.get);
  return router;
}

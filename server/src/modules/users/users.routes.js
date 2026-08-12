import { Router } from 'express';
import * as usersController from './users.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function usersRoutes() {
  const router = Router();
  router.get('/', requirePermission('users.view'), usersController.list);
  router.post('/', requirePermission('users.manage'), usersController.invite);
  router.post('/:id/roles', requirePermission('users.manage'), usersController.assignRole);
  router.delete('/:id/roles/:roleId', requirePermission('users.manage'), usersController.removeRole);
  router.post('/:id/disable', requirePermission('users.manage'), usersController.disable);
  return router;
}

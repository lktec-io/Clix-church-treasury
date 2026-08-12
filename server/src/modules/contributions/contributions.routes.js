import { Router } from 'express';
import * as contributionsController from './contributions.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function contributionsRoutes() {
  const router = Router();
  router.get('/', requirePermission('income.view'), contributionsController.list);
  router.post('/', requirePermission('income.create'), contributionsController.create);
  router.get('/:id', requirePermission('income.view'), contributionsController.get);
  router.patch('/:id', requirePermission('income.update'), contributionsController.update);
  router.post('/:id/reverse', requirePermission('income.reverse'), contributionsController.reverse);
  return router;
}

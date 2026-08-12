import { Router } from 'express';
import * as expensesController from './expenses.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function expensesRoutes() {
  const router = Router();
  router.get('/', requirePermission('expense.view'), expensesController.list);
  router.post('/', requirePermission('expense.create'), expensesController.create);
  router.get('/:id', requirePermission('expense.view'), expensesController.get);
  router.patch('/:id', requirePermission('expense.update'), expensesController.update);
  router.post('/:id/submit', requirePermission('expense.submit'), expensesController.submit);
  router.post('/:id/approve', requirePermission('expense.approve'), expensesController.approve);
  router.post('/:id/reject', requirePermission('expense.reject'), expensesController.reject);
  router.post('/:id/return', requirePermission('expense.reject'), expensesController.returnForCorrection);
  router.post('/:id/pay', requirePermission('expense.pay'), expensesController.pay);
  return router;
}

import { Router } from 'express';
import * as expensesController from './expenses.controller.js';
import { requirePermission, requireApprovalRole } from '../../middleware/rbac.js';

export function expensesRoutes() {
  const router = Router();
  router.get('/', requirePermission('expense.view'), expensesController.list);
  router.post('/', requirePermission('expense.create'), expensesController.create);
  router.get('/:id', requirePermission('expense.view'), expensesController.get);
  router.patch('/:id', requirePermission('expense.update'), expensesController.update);
  router.post('/:id/submit', requirePermission('expense.submit'), expensesController.submit);
  // THE APPROVALS ROOM'S FOUR WRITES. Each passes the normal permission
  // check AND the role policy: only a Super Administrator ("Admin") or a
  // Senior Treasurer may decide or release an expense. The role gate runs
  // second so a user who lacks the capability entirely still gets the
  // familiar "Missing permission" answer.
  router.post(
    '/:id/approve',
    requirePermission('expense.approve'),
    requireApprovalRole('approve an expense'),
    expensesController.approve
  );
  router.post(
    '/:id/reject',
    requirePermission('expense.reject'),
    requireApprovalRole('reject an expense'),
    expensesController.reject
  );
  router.post(
    '/:id/return',
    requirePermission('expense.reject'),
    requireApprovalRole('return an expense for correction'),
    expensesController.returnForCorrection
  );
  router.post(
    '/:id/pay',
    requirePermission('expense.pay'),
    requireApprovalRole('mark an expense paid'),
    expensesController.pay
  );
  // Permanent removal of an unpaid request. A paid expense is in the ledger
  // and is refused (expenses.service.js#hardDeleteExpense).
  router.delete('/:id', requirePermission('expense.update'), expensesController.remove);
  return router;
}

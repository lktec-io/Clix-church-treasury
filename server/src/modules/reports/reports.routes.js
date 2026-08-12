import { Router } from 'express';
import * as reportsController from './reports.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

// Each report is gated by the permission for the data it exposes — the same
// permission that already gates browsing that data elsewhere in the app, so
// a report can never show someone data the rest of the UI would hide from
// them (docs/MASTER_TODO.md Phase 9: "do not allow users to export data
// they cannot view"). Exporting (any non-JSON format) additionally requires
// reports.export, checked in reports.controller.js#respond.
export function reportsRoutes() {
  const router = Router();
  router.get('/income', requirePermission('income.view'), reportsController.income);
  router.get('/expense', requirePermission('expense.view'), reportsController.expense);
  router.get('/transaction-journal', requirePermission('reports.view'), reportsController.transactionJournal);
  router.get('/contributions', requirePermission('income.view'), reportsController.contributions);
  router.get('/accounts/:accountId/statement', requirePermission('accounts.view'), reportsController.accountStatement);
  router.get('/funds/:fundId/statement', requirePermission('funds.view'), reportsController.fundStatement);
  router.get('/budget-vs-actual', requirePermission('budget.view'), reportsController.budgetVsActual);
  router.get('/pledges', requirePermission('pledges.view'), reportsController.pledgeReport);
  router.get('/financial-summary', requirePermission('reports.view'), reportsController.financialSummary);
  return router;
}

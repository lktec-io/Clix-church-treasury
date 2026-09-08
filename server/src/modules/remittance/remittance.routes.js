import { Router } from 'express';
import * as remittanceController from './remittance.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

// Viewing the obligation is a reporting-tier action; configuring the rules
// and actually paying money out are not. `remittance.pay` is deliberately
// its own permission rather than reusing expense.pay: remitting to the
// Conference is a different authority from settling a supplier invoice,
// and a church that wants those in different hands must be able to say so.
export function remittanceRoutes() {
  const router = Router();
  router.get('/', requirePermission('remittance.view'), remittanceController.overview);
  router.get('/rules', requirePermission('remittance.view'), remittanceController.listRules);
  router.post('/rules', requirePermission('remittance.manage'), remittanceController.createRule);
  router.post('/:id/remit', requirePermission('remittance.pay'), remittanceController.remit);
  return router;
}

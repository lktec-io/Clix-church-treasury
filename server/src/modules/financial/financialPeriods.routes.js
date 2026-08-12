import { Router } from 'express';
import * as financialPeriodsController from './financialPeriods.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function financialPeriodsRoutes() {
  const router = Router();
  router.get('/', requirePermission('financial_period.view'), financialPeriodsController.list);
  router.post('/', requirePermission('financial_period.manage'), financialPeriodsController.create);
  router.get('/:id', requirePermission('financial_period.view'), financialPeriodsController.get);
  router.get('/:id/summary', requirePermission('financial_period.view'), financialPeriodsController.summary);
  router.get('/:id/checklist', requirePermission('financial_period.close'), financialPeriodsController.checklist);
  router.post('/:id/close', requirePermission('financial_period.close'), financialPeriodsController.close);
  router.post('/:id/reopen', requirePermission('financial_period.reopen'), financialPeriodsController.reopen);
  return router;
}

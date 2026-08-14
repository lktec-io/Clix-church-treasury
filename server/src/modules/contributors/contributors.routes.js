import { Router } from 'express';
import * as contributorsController from './contributors.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function contributorsRoutes() {
  const router = Router();
  router.get('/', requirePermission('contributors.view'), contributorsController.list);
  router.post('/', requirePermission('contributors.manage'), contributorsController.create);
  router.get('/:id', requirePermission('contributors.view'), contributorsController.get);
  router.get('/:id/statement', requirePermission('contributors.view'), contributorsController.statement);
  router.get('/:id/statement/pdf', requirePermission('contributors.view'), contributorsController.statementPdf);
  router.post('/:id/statement/send-sms', requirePermission('contributors.manage'), contributorsController.sendStatementSms);
  router.post('/:id/portal-access', requirePermission('contributors.manage'), contributorsController.enablePortal);
  router.post(
    '/:id/portal-access/reset-pin',
    requirePermission('contributors.manage'),
    contributorsController.resetContributorPin
  );
  return router;
}

import { Router } from 'express';
import * as contributorsController from './contributors.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

export function contributorsRoutes() {
  const router = Router();
  router.get('/', requirePermission('contributors.view'), contributorsController.list);
  router.post('/', requirePermission('contributors.manage'), contributorsController.create);
  // Both bulk-import routes are declared BEFORE '/:id' — Express matches in
  // declaration order, so registering them after would let '/:id' swallow
  // "bulk-import" as an id and 404 every request to them.
  router.get(
    '/bulk-import/template',
    requirePermission('contributors.manage'),
    contributorsController.bulkImportTemplate
  );
  router.post('/bulk-import', requirePermission('contributors.manage'), contributorsController.bulkImport);
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

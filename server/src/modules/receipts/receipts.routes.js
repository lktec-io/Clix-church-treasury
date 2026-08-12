import { Router } from 'express';
import * as receiptsController from './receipts.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

// No create route — receipts are only ever issued automatically alongside a
// contribution (receipts.service.js#issueReceiptForContribution), never
// created directly by a user.
export function receiptsRoutes() {
  const router = Router();
  // More specific path registered first — Express matches in order, and
  // `/:id` would otherwise swallow `/by-contribution/...` as if
  // "by-contribution" were an id.
  router.get('/by-contribution/:contributionId', requirePermission('receipts.view'), receiptsController.getForContribution);
  router.get('/:id/pdf', requirePermission('receipts.view'), receiptsController.downloadPdf);
  router.get('/:id', requirePermission('receipts.view'), receiptsController.get);
  return router;
}

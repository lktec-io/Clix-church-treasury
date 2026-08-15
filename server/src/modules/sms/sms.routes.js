import { Router } from 'express';
import * as smsController from './sms.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

// settings.manage — the same permission gate church_settings itself would
// use — since this is infrastructure/configuration visibility, not a
// financial or member-privacy concern.
export function smsRoutes() {
  const router = Router();
  router.get('/status', requirePermission('settings.manage'), smsController.status);
  return router;
}

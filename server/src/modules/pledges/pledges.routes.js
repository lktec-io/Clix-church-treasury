import { Router } from 'express';
import * as pledgesController from './pledges.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

// pledges.create doubles as the update/status-change permission too — no
// separate approval workflow was requested for pledges (contrast expenses),
// so one permission for every write action is enough
// (docs/PROJECT_ARCHITECTURE.md — "only create additional permissions if
// genuinely necessary").
export function pledgesRoutes() {
  const router = Router();
  router.get('/', requirePermission('pledges.view'), pledgesController.list);
  router.post('/', requirePermission('pledges.create'), pledgesController.create);
  router.get('/:id', requirePermission('pledges.view'), pledgesController.get);
  router.patch('/:id', requirePermission('pledges.create'), pledgesController.update);
  router.post('/:id/status', requirePermission('pledges.create'), pledgesController.setStatus);
  return router;
}

import { Router } from 'express';
import * as rolesController from './roles.controller.js';
import { requirePermission } from '../../middleware/rbac.js';

// Gated by users.view (not a separate roles.view permission) — the role
// catalog is only ever useful in the context of managing users, and adding
// a new permission for a single read-only list would be exactly the kind
// of unnecessary module growth docs/MASTER_TODO.md warns against.
export function rolesRoutes() {
  const router = Router();
  router.get('/', requirePermission('users.view'), rolesController.list);
  return router;
}

import { Router } from 'express';
import * as platformController from './platform.controller.js';

// requirePlatformAdmin is applied once, at the mount point in app.js
// (`app.use('/api/v1/platform', ..., requirePlatformAdmin, platformRoutes())`)
// — every route in this router is platform-admin-only with no exceptions,
// so there is deliberately no route-by-route permission variation here
// the way tenant modules have (income.view vs income.create, etc.):
// platform.manage is the one and only gate for this entire surface.
export function platformRoutes() {
  const router = Router();
  router.get('/tenants', platformController.listTenants);
  router.post('/tenants', platformController.createTenant);
  router.get('/tenants/:id', platformController.getTenant);
  router.patch('/tenants/:id', platformController.updateTenant);
  router.patch('/tenants/:id/status', platformController.setTenantStatus);
  return router;
}

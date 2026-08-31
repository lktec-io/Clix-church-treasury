import { Router } from 'express';
import * as authController from './auth.controller.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';

// login/refresh/logout/password-reset are deliberately outside the
// authenticate+tenantContext chain — the exceptions docs/API_ARCHITECTURE.md
// §3 names. `/me` is the one route in this file that DOES require
// authentication — the frontend's access token lives in memory only
// (src/api/client.js), so a page reload needs a way to recover "who is
// logged in" using just the refresh cookie: call /auth/refresh for a fresh
// access token, then /auth/me to load the session it belongs to.
//
// There is deliberately NO public /register-tenant route — that public,
// unauthenticated tenant-creation endpoint was removed: every tenant is
// now created by a Platform Administrator through /api/v1/platform/tenants
// (requirePlatformAdmin-gated, see platform.routes.js), never by an
// anonymous visitor. The underlying capability (auth.service.js's
// registerTenant, and the shared tenants.service.js#createTenantWithConnection
// it and platform.service.js#createTenant both build on) is intentionally
// left in place — only the public HTTP door into it was closed.
export function authRoutes({ authenticate, tenantContext }) {
  const router = Router();
  router.use(authRateLimiter);
  router.post('/login', authController.login);
  router.post('/refresh', authController.refresh);
  router.post('/logout', authController.logout);
  router.post('/password-reset/request', authController.requestPasswordReset);
  router.post('/password-reset/confirm', authController.resetPassword);
  router.get('/me', authenticate, tenantContext, authController.me);
  return router;
}

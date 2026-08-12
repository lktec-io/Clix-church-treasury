import { Router } from 'express';
import * as authController from './auth.controller.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';

// register-tenant/login/refresh/logout/password-reset are deliberately
// outside the authenticate+tenantContext chain — the three exceptions
// docs/API_ARCHITECTURE.md §3 names. `/me` is the one route in this file
// that DOES require authentication — the frontend's access token lives in
// memory only (src/api/client.js), so a page reload needs a way to recover
// "who is logged in" using just the refresh cookie: call /auth/refresh for a
// fresh access token, then /auth/me to load the session it belongs to.
export function authRoutes({ authenticate, tenantContext }) {
  const router = Router();
  router.use(authRateLimiter);
  router.post('/register-tenant', authController.registerTenant);
  router.post('/login', authController.login);
  router.post('/refresh', authController.refresh);
  router.post('/logout', authController.logout);
  router.post('/password-reset/request', authController.requestPasswordReset);
  router.post('/password-reset/confirm', authController.resetPassword);
  router.get('/me', authenticate, tenantContext, authController.me);
  return router;
}

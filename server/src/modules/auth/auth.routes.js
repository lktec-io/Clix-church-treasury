import { Router } from 'express';
import * as authController from './auth.controller.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';

// Deliberately outside the authenticate+tenantContext chain — these are the
// three routes docs/API_ARCHITECTURE.md §3 names as the exceptions.
export function authRoutes() {
  const router = Router();
  router.use(authRateLimiter);
  router.post('/register-tenant', authController.registerTenant);
  router.post('/login', authController.login);
  router.post('/refresh', authController.refresh);
  router.post('/logout', authController.logout);
  router.post('/password-reset/request', authController.requestPasswordReset);
  router.post('/password-reset/confirm', authController.resetPassword);
  return router;
}

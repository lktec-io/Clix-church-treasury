import { Router } from 'express';
import * as memberAuthController from './memberAuth.controller.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';

// Mirrors auth/auth.routes.js's shape exactly: login/refresh/logout are
// deliberately public (pre-auth by nature); /me and /change-pin are the
// two routes in this file that require an established member session.
export function memberAuthRoutes({ authenticateMember, memberContext }) {
  const router = Router();
  router.use(authRateLimiter);
  router.post('/login', memberAuthController.login);
  router.post('/refresh', memberAuthController.refresh);
  router.post('/logout', memberAuthController.logout);
  router.get('/me', authenticateMember, memberContext, memberAuthController.me);
  router.post('/change-pin', authenticateMember, memberContext, memberAuthController.changePin);
  return router;
}

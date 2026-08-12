import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { authenticate } from './middleware/authenticate.js';
import { tenantContext } from './middleware/tenantContext.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { accountsRoutes } from './modules/accounts/accounts.routes.js';
import { fundsRoutes } from './modules/funds/funds.routes.js';

// Middleware order matters and matches docs/API_ARCHITECTURE.md §3:
// secure headers -> CORS -> body/cookie parsing -> rate limit -> auth ->
// tenant context -> per-route RBAC (inside each module's routes) -> controller
// -> centralized error handler (mounted last).
//
// `authenticate` is injectable so tests can substitute a fake-auth middleware
// instead of verifying real JWTs (see tests/helpers/testApp.js). Production
// always uses the real one — see src/server.js.
export function createApp({ authenticate: authenticateOverride } = {}) {
  const auth = authenticateOverride ?? authenticate;
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.cors.origins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok' } });
  });

  app.use('/api/v1/auth', authRoutes());

  app.use('/api/v1/users', apiRateLimiter, auth, tenantContext, usersRoutes());
  app.use('/api/v1/audit-logs', apiRateLimiter, auth, tenantContext, auditRoutes());
  app.use('/api/v1/accounts', apiRateLimiter, auth, tenantContext, accountsRoutes());
  app.use('/api/v1/funds', apiRateLimiter, auth, tenantContext, fundsRoutes());

  app.use((req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler);
  return app;
}

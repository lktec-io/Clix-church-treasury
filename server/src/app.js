import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { authenticate } from './middleware/authenticate.js';
import { tenantContext } from './middleware/tenantContext.js';
import { authenticateMember } from './middleware/authenticateMember.js';
import { memberContext } from './middleware/memberContext.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { memberAuthRoutes } from './modules/memberAuth/memberAuth.routes.js';
import { memberRoutes } from './modules/memberAuth/member.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { accountsRoutes } from './modules/accounts/accounts.routes.js';
import { fundsRoutes } from './modules/funds/funds.routes.js';
import { categoriesRoutes } from './modules/categories/categories.routes.js';
import { contributorsRoutes } from './modules/contributors/contributors.routes.js';
import { contributionsRoutes } from './modules/contributions/contributions.routes.js';
import { expensesRoutes } from './modules/expenses/expenses.routes.js';
import { transfersRoutes } from './modules/transfers/transfers.routes.js';
import { pledgesRoutes } from './modules/pledges/pledges.routes.js';
import { receiptsRoutes } from './modules/receipts/receipts.routes.js';
import { budgetsRoutes } from './modules/budgets/budgets.routes.js';
import { financialPeriodsRoutes } from './modules/financial/financialPeriods.routes.js';
import { reportsRoutes } from './modules/reports/reports.routes.js';
import { rolesRoutes } from './modules/roles/roles.routes.js';
import { smsRoutes } from './modules/sms/sms.routes.js';

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

  app.use('/api/v1/auth', authRoutes({ authenticate: auth, tenantContext }));

  // Member self-service portal — a fully parallel auth/middleware chain
  // (authenticateMember/memberContext, never authenticate/tenantContext)
  // for the second subject type (contributors, not users). See
  // docs/MASTER_TODO.md's member-portal plan for why this is a separate
  // chain rather than an extension of the staff one.
  app.use('/api/v1/member/auth', memberAuthRoutes({ authenticateMember, memberContext }));
  app.use('/api/v1/member', apiRateLimiter, authenticateMember, memberContext, memberRoutes());

  app.use('/api/v1/users', apiRateLimiter, auth, tenantContext, usersRoutes());
  app.use('/api/v1/audit-logs', apiRateLimiter, auth, tenantContext, auditRoutes());
  app.use('/api/v1/accounts', apiRateLimiter, auth, tenantContext, accountsRoutes());
  app.use('/api/v1/funds', apiRateLimiter, auth, tenantContext, fundsRoutes());
  app.use('/api/v1/categories', apiRateLimiter, auth, tenantContext, categoriesRoutes());
  app.use('/api/v1/contributors', apiRateLimiter, auth, tenantContext, contributorsRoutes());
  app.use('/api/v1/contributions', apiRateLimiter, auth, tenantContext, contributionsRoutes());
  app.use('/api/v1/expenses', apiRateLimiter, auth, tenantContext, expensesRoutes());
  app.use('/api/v1/transfers', apiRateLimiter, auth, tenantContext, transfersRoutes());
  app.use('/api/v1/pledges', apiRateLimiter, auth, tenantContext, pledgesRoutes());
  app.use('/api/v1/receipts', apiRateLimiter, auth, tenantContext, receiptsRoutes());
  app.use('/api/v1/budgets', apiRateLimiter, auth, tenantContext, budgetsRoutes());
  app.use('/api/v1/financial-periods', apiRateLimiter, auth, tenantContext, financialPeriodsRoutes());
  app.use('/api/v1/reports', apiRateLimiter, auth, tenantContext, reportsRoutes());
  app.use('/api/v1/roles', apiRateLimiter, auth, tenantContext, rolesRoutes());
  app.use('/api/v1/sms', apiRateLimiter, auth, tenantContext, smsRoutes());

  app.use((req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler);
  return app;
}

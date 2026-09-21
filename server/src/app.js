import express from 'express';
import { readMigrationStatus } from './db/pendingMigrations.js';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { authenticate } from './middleware/authenticate.js';
import { tenantContext } from './middleware/tenantContext.js';
import { authenticateMember } from './middleware/authenticateMember.js';
import { memberContext } from './middleware/memberContext.js';
import { requirePlatformAdmin } from './middleware/rbac.js';
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
import { departmentsRoutes } from './modules/departments/departments.routes.js';
import { contributorsRoutes } from './modules/contributors/contributors.routes.js';
import { contributionsRoutes } from './modules/contributions/contributions.routes.js';
import { expensesRoutes } from './modules/expenses/expenses.routes.js';
import { remittanceRoutes } from './modules/remittance/remittance.routes.js';
import { transfersRoutes } from './modules/transfers/transfers.routes.js';
import { pledgesRoutes } from './modules/pledges/pledges.routes.js';
import { receiptsRoutes } from './modules/receipts/receipts.routes.js';
import { budgetsRoutes } from './modules/budgets/budgets.routes.js';
import { financialPeriodsRoutes } from './modules/financial/financialPeriods.routes.js';
import { reportsRoutes } from './modules/reports/reports.routes.js';
import { rolesRoutes } from './modules/roles/roles.routes.js';
import { smsRoutes } from './modules/sms/sms.routes.js';
import { platformRoutes } from './modules/platform/platform.routes.js';

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

  // Liveness plus schema state. Still HTTP 200 when migrations are pending —
  // the process is up and a load balancer must not restart it — but the
  // body says "degraded" and how many are missing, which the header's status
  // light (SystemStatus.jsx) turns into a visible "Server issue".
  // Read live (5s TTL) rather than from a boot-time snapshot: after an
  // operator runs `npm run migrate`, /health must go green on its own. It
  // reporting "degraded" until someone restarts the server is how a fixed
  // database gets mistaken for a broken one.
  app.get('/health', async (req, res, next) => {
    try {
      const status = await readMigrationStatus();
      const missingColumns = status.missingColumns ?? [];
      res.json({
        success: true,
        data: {
          // Missing columns count as degraded even with nothing pending: that
          // is the state in which recording income fails while `npm run
          // migrate` claims there is nothing to do.
          status: status.pending.length > 0 || missingColumns.length > 0 ? 'degraded' : 'ok',
          pendingMigrations: status.pending.length,
          missingColumns,
          database: status.database,
          // false = the check itself could not run, which is not a clean bill
          // of health and must not be displayed as one.
          schemaChecked: status.checked,
        },
      });
    } catch (err) {
      next(err);
    }
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
  app.use('/api/v1/departments', apiRateLimiter, auth, tenantContext, departmentsRoutes());
  app.use('/api/v1/contributors', apiRateLimiter, auth, tenantContext, contributorsRoutes());
  app.use('/api/v1/contributions', apiRateLimiter, auth, tenantContext, contributionsRoutes());
  app.use('/api/v1/expenses', apiRateLimiter, auth, tenantContext, expensesRoutes());
  app.use('/api/v1/remittance', apiRateLimiter, auth, tenantContext, remittanceRoutes());
  app.use('/api/v1/transfers', apiRateLimiter, auth, tenantContext, transfersRoutes());
  app.use('/api/v1/pledges', apiRateLimiter, auth, tenantContext, pledgesRoutes());
  app.use('/api/v1/receipts', apiRateLimiter, auth, tenantContext, receiptsRoutes());
  app.use('/api/v1/budgets', apiRateLimiter, auth, tenantContext, budgetsRoutes());
  app.use('/api/v1/financial-periods', apiRateLimiter, auth, tenantContext, financialPeriodsRoutes());
  app.use('/api/v1/reports', apiRateLimiter, auth, tenantContext, reportsRoutes());
  app.use('/api/v1/roles', apiRateLimiter, auth, tenantContext, rolesRoutes());
  app.use('/api/v1/sms', apiRateLimiter, auth, tenantContext, smsRoutes());

  // Platform-level, deliberately WITHOUT tenantContext — a platform admin
  // manages tenants across the whole platform, not scoped to their own
  // tenant_id the way every route above is. requirePlatformAdmin (an
  // ordinary permission check, see middleware/rbac.js) is the entire
  // authorization boundary here, applied to every route in
  // platformRoutes() with no exceptions.
  app.use('/api/v1/platform', apiRateLimiter, auth, requirePlatformAdmin, platformRoutes());

  app.use((req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler);
  return app;
}

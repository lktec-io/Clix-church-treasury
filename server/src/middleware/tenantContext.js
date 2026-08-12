import { unauthenticated } from '../errors/AppError.js';

// Derives req.tenantId from the authenticated request context only.
// Phase 2's JWT-verification middleware is what populates req.auth — this
// middleware never reads tenantId from params, query, or body (SECURITY_ARCHITECTURE.md §1).
// Runs after authentication middleware in the stack (docs/API_ARCHITECTURE.md §3).
export function tenantContext(req, res, next) {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) {
    return next(unauthenticated('No tenant context on request'));
  }
  req.tenantId = tenantId;
  next();
}

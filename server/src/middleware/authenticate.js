import { unauthenticated } from '../errors/AppError.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

// Verifies the JWT bearer token and attaches req.auth = { userId, tenantId, roles }.
// This is what tenantContext.js reads from.
export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(unauthenticated('Missing bearer token'));
  }
  const token = header.slice('Bearer '.length);
  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch {
    next(unauthenticated('Invalid or expired token'));
  }
}

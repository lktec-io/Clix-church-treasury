import { createApp } from '../../src/app.js';

// Test-only stand-in for Phase 2's real JWT-verification middleware.
// Injects a trusted req.auth directly, mirroring exactly what the real
// middleware will attach after verifying a token.
export function fakeAuth(user) {
  return (req, res, next) => {
    req.auth = user; // { userId, tenantId, roles }
    next();
  };
}

export function buildTestApp(user) {
  return createApp({ authenticate: fakeAuth(user) });
}

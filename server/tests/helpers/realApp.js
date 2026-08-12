import { createApp } from '../../src/app.js';

// The real app, with real JWT-verifying authenticate middleware — for tests
// that exercise the actual auth flow end to end (as opposed to
// tests/helpers/testApp.js, which injects a trusted fake identity for tests
// that are about something other than auth itself, e.g. tenant isolation).
export function buildRealApp() {
  return createApp();
}

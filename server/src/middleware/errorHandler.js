import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

// Last middleware in the stack (docs/API_ARCHITECTURE.md §3, §4). Never leaks
// stack traces or raw DB error text to the client in production.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) },
    });
  }

  // Body-parser and similar Express/Connect middleware throw plain errors
  // with a `.status`/`.statusCode` (e.g. malformed JSON = 400) rather than an
  // AppError. Honor that instead of collapsing every non-AppError into 500.
  const status = err.status ?? err.statusCode;
  if (status && status >= 400 && status < 500) {
    return res.status(status).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: env.isProduction ? 'Invalid request' : err.message },
    });
  }

  // Always logged server-side — production included. Only the client-facing
  // message is redacted in production (docs/MASTER_TODO.md Phase 11/12:
  // production logging must help diagnose failures, never expose them).
  console.error(err);

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: env.isProduction ? 'An unexpected error occurred' : err.message,
    },
  });
}

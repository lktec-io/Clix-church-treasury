import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { getPendingMigrations } from '../db/pendingMigrations.js';

// MySQL errors that mean "this code expects a table or column the database
// does not have" — schema drift, almost always an unapplied migration.
const SCHEMA_ERROR_CODES = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']);

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

  // SCHEMA DRIFT. Reported as 503 with an actionable message instead of a
  // bare 500: nothing is wrong with the request, the server is simply not
  // ready for it, and the operator needs to know the fix is a command, not
  // a code change. Any ledger transaction this happened in was rolled back
  // whole, so nothing was half-recorded and a retry after migrating is safe.
  // The message names no data, so it is shown in production too; the raw
  // MySQL text (which names the table) is logged and shown only outside it.
  if (SCHEMA_ERROR_CODES.has(err.code)) {
    const pending = getPendingMigrations();
    console.error(
      `[schema] ${req.method} ${req.originalUrl} failed on a missing table/column: ${err.message}` +
        (pending.length > 0 ? ` — pending migrations: ${pending.join(', ')}` : '')
    );
    return res.status(503).json({
      success: false,
      error: {
        code: 'SCHEMA_OUT_OF_DATE',
        message:
          'The server database is missing an update this action needs, so nothing was saved. ' +
          'An administrator must run "npm run migrate" on the server, then try again.',
        ...(env.isProduction ? {} : { detail: err.message, pendingMigrations: pending }),
      },
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

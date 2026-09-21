import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { readMigrationStatus } from '../db/pendingMigrations.js';
import { invalidateSchemaCaches } from '../db/schemaGuard.js';

// MySQL errors that mean "this code expects a table or column the database
// does not have" — schema drift, almost always an unapplied migration.
const SCHEMA_ERROR_CODES = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']);

// Last middleware in the stack (docs/API_ARCHITECTURE.md §3, §4). Never leaks
// stack traces or raw DB error text to the client in production.
// Async because the schema branch re-reads migration status before it
// answers. Express ignores the returned promise, which is fine: every path
// through this function responds, and a throw inside it would be a bug
// regardless of whether it were sync or async.
// eslint-disable-next-line no-unused-vars
export async function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.fields ? { fields: err.fields } : {}),
        ...(err.details ? { details: err.details } : {}),
      },
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
    // RE-READ THE DATABASE BEFORE BLAMING IT. The status is fetched live
    // (readMigrationStatus, 5s TTL) rather than taken from a boot-time
    // snapshot, so an operator who has just run `npm run migrate` is not
    // told the migrations are still missing. It also decides WHICH message
    // to send: if nothing is pending, the schema is not behind at all and
    // "run the migrations" would send them chasing the wrong thing.
    //
    // Any cached column probe is dropped at the same time. A repository that
    // learned "this column does not exist" before the migration ran would
    // otherwise keep acting on that until the process restarts.
    invalidateSchemaCaches();
    const status = await readMigrationStatus({ force: true });
    const pending = status.pending;

    console.error(
      `[schema] ${req.method} ${req.originalUrl} failed on a missing table/column: ${err.message}` +
        ` — database "${status.database ?? 'unknown'}" (${env.db.host}:${env.db.port})` +
        (pending.length > 0 ? `, pending migrations: ${pending.join(', ')}` : ', no migrations pending')
    );

    // Two genuinely different situations, told apart rather than merged.
    const message =
      pending.length > 0
        ? 'The server database is missing an update this action needs, so nothing was saved. ' +
          'An administrator must run "npm run migrate" on the server, then try again.'
        : 'This action failed against the server database and nothing was saved. The migrations ' +
          'are all applied, so this is not a pending update — an administrator should check the ' +
          'server logs. Trying again may work.';

    return res.status(503).json({
      success: false,
      error: {
        code: 'SCHEMA_OUT_OF_DATE',
        message,
        // The database NAME is not a secret (src/db/check.js documents the
        // same judgement) and it is the single most useful fact when someone
        // has migrated a different database than the one this process uses.
        database: status.database,
        pendingMigrations: pending,
        ...(env.isProduction ? {} : { detail: err.message }),
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

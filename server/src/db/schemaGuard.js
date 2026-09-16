// Recognises the MySQL errors that mean "the code is ahead of the schema":
// a table or column that a pending migration would create.
//
// Deploying code before running migrations is a normal ordering on a live
// server, and it has already produced two production 500s in this codebase
// (contributors.gender, then the general-ledger tables). Read paths that
// only ENRICH a response — a dashboard card, a compliance badge — should
// degrade to "not available yet" rather than take the whole page down with
// them. Write paths must still fail loudly: silently dropping data the user
// entered is worse than an error.
const SCHEMA_MISSING_CODES = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']);

export function isSchemaMissingError(error) {
  return SCHEMA_MISSING_CODES.has(error?.code);
}

/**
 * Runs `fn`; if it fails because the schema is behind, logs once per key and
 * returns `fallback` instead. Any other error propagates unchanged.
 */
const warned = new Set();
export async function withSchemaFallback(key, fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    if (!isSchemaMissingError(error)) throw error;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(
        `[schema] ${key} is unavailable — a pending migration has not been applied ` +
          `(${error.sqlMessage ?? error.message}). Run "npm run migrate" in server/.`
      );
    }
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

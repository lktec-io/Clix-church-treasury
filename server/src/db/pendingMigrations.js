import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { listMigrationFiles, migrationName } from './migrate.js';

// SCHEMA DRIFT DETECTION.
//
// Deploying new code without running `npm run migrate` is the single most
// common way this API ends up returning 500s: the code expects a table or
// column (chart_of_accounts from 0037, remittance tables from 0036, the
// contribution columns from 0038/0039) that the database does not have yet,
// and every request touching it fails inside its transaction.
//
// The server cannot migrate itself safely at boot (migrations can be long,
// and two PM2 workers would race each other), but it can refuse to be quiet
// about it.
//
// READ LIVE, NOT ONCE AT BOOT.
//
// This used to resolve once at startup and keep the answer for the life of
// the process. That made the cure look like the disease: an operator ran
// `npm run migrate`, fixed the database, and /health plus every error
// message went on reporting the same migrations as missing until someone
// restarted the server — so the obvious conclusion was that the fix had not
// worked. The status is now re-read from schema_migrations, behind a short
// TTL so a burst of failing requests cannot turn one outage into a query
// storm. Applying a migration is visible within TTL_MS, with no restart.
const TTL_MS = 5000;

// SHAPE CHECK — the columns the money-moving write paths cannot work without.
//
// schema_migrations only records that a migration FILE ran, not that the
// schema it was meant to produce exists. When a migration file is edited
// after the fact, or a table is created by hand, the two part company:
// `npm run migrate` reports nothing pending while every contribution fails
// on an unknown column. That is exactly what happened to the general ledger
// (see migration 0041). So the status also verifies the columns directly.
//
// Deliberately a short list of what would break recording money, not a
// copy of the whole schema: it has to stay correct without upkeep.
const REQUIRED_COLUMNS = {
  contributions: ['transaction_id', 'fee_transaction_id'],
  chart_of_accounts: ['code', 'account_type', 'normal_balance', 'system_role'],
  journal_entries: ['transaction_id', 'financial_period_id', 'entry_date', 'memo'],
  journal_lines: ['journal_entry_id', 'coa_account_id', 'fund_id', 'debit', 'credit', 'description'],
};

let cache = { at: 0, pending: [], missingColumns: [], database: null, checked: false };
let inFlight = null;

/**
 * Live migration status: `{ pending, database, checked }`.
 *
 * `database` is the schema this PROCESS is actually connected to — the
 * decisive fact when migrations were run somewhere else (a different
 * DB_NAME, a different host, a staging .env), which is by far the most
 * common reason a migration "did not take". `checked: false` means the
 * status query itself failed, which is not the same as "nothing pending".
 */
export async function readMigrationStatus({ force = false } = {}) {
  const fresh = !force && Date.now() - cache.at < TTL_MS;
  if (fresh && cache.checked) return cache;
  // Coalesce concurrent callers onto one query: when the schema is broken,
  // every in-flight request hits this path at once.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let connection;
    try {
      connection = await pool.getConnection();
      const upFiles = await listMigrationFiles('up');
      const names = upFiles.map(migrationName);

      const [[row]] = await connection.query('SELECT DATABASE() AS `current`');
      const [tables] = await connection.query("SHOW TABLES LIKE 'schema_migrations'");
      const applied = new Set();
      if (tables.length > 0) {
        const [rows] = await connection.query('SELECT name FROM schema_migrations');
        rows.forEach((r) => applied.add(r.name));
      }

      // One query for every required column, compared as "table.column".
      const [present] = await connection.query(
        `SELECT table_name AS t, column_name AS c
           FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name IN (?)`,
        [Object.keys(REQUIRED_COLUMNS)]
      );
      const have = new Set(present.map((r) => `${r.t ?? r.TABLE_NAME}.${r.c ?? r.COLUMN_NAME}`));
      const missingColumns = Object.entries(REQUIRED_COLUMNS).flatMap(([table, columns]) =>
        columns.map((column) => `${table}.${column}`).filter((key) => !have.has(key))
      );

      cache = {
        at: Date.now(),
        pending: names.filter((name) => !applied.has(name)),
        missingColumns,
        database: row?.current ?? null,
        checked: true,
      };
      return cache;
    } catch (error) {
      // A failed check must never stop the API from starting or turn one
      // failure into two. Report it and say so honestly: unknown, not clear.
      console.error(`[schema] could not check migration status: ${error.message}`);
      cache = { at: Date.now(), pending: [], missingColumns: [], database: null, checked: false };
      return cache;
    } finally {
      connection?.release();
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Last known pending list, without a query. For synchronous callers only —
 * anything that can await should use readMigrationStatus() so it sees the
 * database as it is right now.
 */
export function getPendingMigrations() {
  return cache.pending;
}

/** Startup probe: logs the gap loudly and primes the cache. */
export async function checkPendingMigrations() {
  const status = await readMigrationStatus({ force: true });
  if (!status.checked) return [];

  if (status.pending.length > 0) {
    console.error(
      `\n[schema] ${status.pending.length} database migration(s) have NOT been applied` +
        ` to "${status.database}" (${env.db.host}:${env.db.port}):\n` +
        status.pending.map((name) => `           [ ] ${name}`).join('\n') +
        '\n[schema] Requests that touch these tables will fail until you run:  npm run migrate   (in server/)' +
        '\n[schema] If you already ran it: check that DB_NAME/DB_HOST in this process\'s .env' +
        ' match the database you migrated.\n'
    );
  } else if (status.missingColumns.length === 0) {
    console.log(`[schema] "${status.database}" is up to date (all migrations applied, required columns present)`);
  }

  // Reported even when nothing is pending — that combination is the
  // dangerous one, because it is the case where `npm run migrate` looks
  // like it has nothing left to fix.
  if (status.missingColumns.length > 0) {
    console.error(
      `\n[schema] "${status.database}" is MISSING columns the code writes, even though` +
        ` ${status.pending.length === 0 ? 'every migration is recorded as applied' : 'see pending list above'}:\n` +
        status.missingColumns.map((key) => `           [ ] ${key}`).join('\n') +
        '\n[schema] Recording income will fail until this is fixed. This usually means a migration file' +
        '\n[schema] was edited after it ran, or a table was created by hand. Run `npm run migrate`:' +
        '\n[schema] migration 0041 repairs the general ledger and contribution columns.\n'
    );
  }
  return status.pending;
}

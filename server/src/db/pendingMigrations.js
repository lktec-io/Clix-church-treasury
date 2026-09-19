import { pool } from '../config/db.js';
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
// about it. This compares the migration files shipped with this build against
// schema_migrations once at startup, logs the gap loudly, and keeps the
// result so /health and the error handler can report it.

let pending = null;

/** Names of migrations present in this build but not applied to the database. */
export function getPendingMigrations() {
  return pending ?? [];
}

export async function checkPendingMigrations() {
  let connection;
  try {
    connection = await pool.getConnection();
    const upFiles = await listMigrationFiles('up');
    const names = upFiles.map(migrationName);

    const [tables] = await connection.query("SHOW TABLES LIKE 'schema_migrations'");
    const applied = new Set();
    if (tables.length > 0) {
      const [rows] = await connection.query('SELECT name FROM schema_migrations');
      rows.forEach((row) => applied.add(row.name));
    }

    pending = names.filter((name) => !applied.has(name));
    if (pending.length > 0) {
      console.error(
        `\n[schema] ${pending.length} database migration(s) have NOT been applied:\n` +
          pending.map((name) => `           [ ] ${name}`).join('\n') +
          '\n[schema] Requests that touch these tables will fail until you run:  npm run migrate   (in server/)\n'
      );
    } else {
      console.log(`[schema] database is up to date (${names.length} migrations applied)`);
    }
    return pending;
  } catch (error) {
    // A failed check must never stop the API from starting: report and move on.
    console.error(`[schema] could not check migration status: ${error.message}`);
    pending = null;
    return [];
  } finally {
    connection?.release();
  }
}

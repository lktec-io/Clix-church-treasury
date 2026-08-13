import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// Exported so migrateStatus.js can list pending/applied migrations using
// the exact same file-discovery logic the runner itself uses, rather than
// a second, potentially-drifting implementation.
export async function listMigrationFiles(direction) {
  const suffix = `.${direction}.sql`;
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((file) => file.endsWith(suffix))
    .sort((a, b) => a.localeCompare(b));
}

export function migrationName(filename) {
  // "0001_create_tenants.up.sql" -> "0001_create_tenants"
  return filename.replace(/\.(up|down)\.sql$/, '');
}

async function runStatements(connection, sql) {
  // Split on semicolons at statement boundaries. Migration files must not
  // rely on semicolons inside string literals for this simple splitter to work.
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await connection.query(statement);
  }
}

export async function up() {
  const connection = await pool.getConnection();
  try {
    await ensureMigrationsTable(connection);
    const [appliedRows] = await connection.query('SELECT name FROM schema_migrations');
    const applied = new Set(appliedRows.map((r) => r.name));

    const upFiles = await listMigrationFiles('up');
    const pending = upFiles.filter((file) => !applied.has(migrationName(file)));

    if (pending.length === 0) {
      console.log('No pending migrations.');
      return [];
    }

    const ranNames = [];
    for (const file of pending) {
      const name = migrationName(file);
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`Applying ${name}...`);
      await connection.beginTransaction();
      try {
        await runStatements(connection, sql);
        await connection.query('INSERT INTO schema_migrations (name, applied_at) VALUES (?, NOW())', [name]);
        await connection.commit();
        ranNames.push(name);
      } catch (error) {
        await connection.rollback();
        console.error(`Migration ${name} failed: ${error.message}`);
        throw error;
      }
    }
    console.log(`Applied ${ranNames.length} migration(s).`);
    return ranNames;
  } finally {
    connection.release();
  }
}

export async function down() {
  const connection = await pool.getConnection();
  try {
    await ensureMigrationsTable(connection);
    const [rows] = await connection.query(
      'SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1'
    );
    if (rows.length === 0) {
      console.log('No migrations to roll back.');
      return null;
    }
    const name = rows[0].name;
    const downFile = `${name}.down.sql`;
    let sql;
    try {
      sql = await readFile(path.join(MIGRATIONS_DIR, downFile), 'utf8');
    } catch {
      throw new Error(
        `Migration "${name}" has no ${downFile} — it is not reversible by the runner. Roll back manually if required.`
      );
    }
    console.log(`Reverting ${name}...`);
    await connection.beginTransaction();
    try {
      await runStatements(connection, sql);
      await connection.query('DELETE FROM schema_migrations WHERE name = ?', [name]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    console.log(`Reverted ${name}.`);
    return name;
  } finally {
    connection.release();
  }
}

async function main() {
  const direction = process.argv[2];
  if (direction === 'up') {
    await up();
  } else if (direction === 'down') {
    await down();
  } else {
    console.error('Usage: node src/db/migrate.js <up|down>');
    process.exitCode = 1;
    return;
  }
  await pool.end();
}

// Only auto-run when executed directly (not when imported by tests).
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
    pool.end();
  });
}

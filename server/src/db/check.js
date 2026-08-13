import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';

// A representative sample, not an exhaustive list — enough to catch "the
// database exists but migrations never ran" or "migrations ran halfway"
// without hand-maintaining every table this app has as the schema grows.
// One from each major area: platform, identity, financial core, a Phase
// 4+ domain table, and the most recently added table.
const CORE_TABLES = ['tenants', 'users', 'roles', 'permissions', 'accounts', 'funds', 'transactions', 'contributions', 'budgets'];

// `npm run db:check` — a fast, credential-free readiness probe for a
// deployment host (docs/MASTER_TODO.md Phase 12 §7): "is the database
// reachable, is it the database we think it is, did migrations actually
// run." Never prints DB_PASSWORD or any other secret — only the database
// name, which is not sensitive.
export async function check() {
  console.log(`Database connection: checking (${env.db.host}:${env.db.port})...`);
  const connection = await pool.getConnection();
  try {
    console.log('Database connection: OK');

    const [[{ current }]] = await connection.query('SELECT DATABASE() AS `current`');
    console.log(`Database: ${current}`);
    if (current !== env.db.database) {
      console.warn(`WARNING: connected database "${current}" does not match configured DB_NAME "${env.db.database}"`);
    }

    const [migrationTables] = await connection.query("SHOW TABLES LIKE 'schema_migrations'");
    const migrationTableExists = migrationTables.length > 0;
    console.log(`Migration table: ${migrationTableExists ? 'OK' : 'MISSING'}`);

    let appliedCount = 0;
    if (migrationTableExists) {
      const [[{ count }]] = await connection.query('SELECT COUNT(*) AS count FROM schema_migrations');
      appliedCount = count;
    }
    console.log(`Applied migrations: ${appliedCount}`);

    const missingTables = [];
    for (const table of CORE_TABLES) {
      const [rows] = await connection.query('SHOW TABLES LIKE ?', [table]);
      if (rows.length === 0) missingTables.push(table);
    }

    const ready = migrationTableExists && appliedCount > 0 && missingTables.length === 0;
    if (missingTables.length > 0) {
      console.log(`Missing core tables: ${missingTables.join(', ')}`);
    }
    console.log(`Schema status: ${ready ? 'READY' : 'NOT READY'}`);

    if (!ready) process.exitCode = 1;
    return { connected: true, database: current, migrationTableExists, appliedCount, missingTables, ready };
  } finally {
    connection.release();
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  check()
    .then(() => pool.end())
    .catch((error) => {
      // Never echo the connection error's raw driver message-and-config
      // blob if it might embed credentials in some driver's error format
      // — mysql2 doesn't include the password in its errors, but the code
      // stays deliberately generic here rather than assuming that forever.
      console.log('Database connection: FAILED');
      console.error(error.code ?? error.message);
      process.exitCode = 1;
      pool.end();
    });
}

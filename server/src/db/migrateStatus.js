import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/db.js';
import { listMigrationFiles, migrationName } from './migrate.js';

// Read-only companion to migrate.js — never applies or reverts anything,
// just reports what's applied vs pending. Reuses the runner's own file
// listing so this can never drift from what `npm run migrate` would
// actually do (docs/MASTER_TODO.md Phase 12: "do not introduce an
// unnecessary migration framework if the current custom runner already works").
export async function status() {
  const connection = await pool.getConnection();
  try {
    const [tables] = await connection.query("SHOW TABLES LIKE 'schema_migrations'");
    if (tables.length === 0) {
      console.log('schema_migrations table does not exist yet — no migrations have ever been run.');
      const upFiles = await listMigrationFiles('up');
      console.log(`Pending: ${upFiles.length}`);
      upFiles.forEach((f) => console.log(`  [ ] ${migrationName(f)}`));
      return { applied: [], pending: upFiles.map(migrationName) };
    }

    const [appliedRows] = await connection.query('SELECT name, applied_at FROM schema_migrations ORDER BY id');
    const appliedByName = new Map(appliedRows.map((r) => [r.name, r.applied_at]));
    const upFiles = await listMigrationFiles('up');
    const allNames = upFiles.map(migrationName);

    console.log(`Applied: ${appliedByName.size}`);
    console.log(`Pending: ${allNames.filter((n) => !appliedByName.has(n)).length}`);
    console.log('');
    for (const name of allNames) {
      if (appliedByName.has(name)) {
        console.log(`  [x] ${name}  (${appliedByName.get(name)})`);
      } else {
        console.log(`  [ ] ${name}`);
      }
    }

    return {
      applied: allNames.filter((n) => appliedByName.has(n)),
      pending: allNames.filter((n) => !appliedByName.has(n)),
    };
  } finally {
    connection.release();
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  status()
    .then(() => pool.end())
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
      pool.end();
    });
}

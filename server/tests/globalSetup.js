// Runs once before the whole test run. Sets NODE_ENV before dynamically
// importing anything that reads it, since ESM top-level imports are hoisted
// and would otherwise see the wrong value.
export default async function globalSetup() {
  process.env.NODE_ENV = 'test';
  const { up } = await import('../src/db/migrate.js');
  const { pool } = await import('../src/config/db.js');
  await up();
  await pool.end();
}

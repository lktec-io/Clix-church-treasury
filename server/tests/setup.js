import { afterAll } from 'vitest';
import { pool } from '../src/config/db.js';

afterAll(async () => {
  await pool.end();
});

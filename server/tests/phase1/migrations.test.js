import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../../src/config/db.js';
import { up } from '../../src/db/migrate.js';

const EXPECTED_TABLES = [
  'tenants',
  'church_settings',
  'system_settings',
  'permissions',
  'users',
  'roles',
  'role_permissions',
  'user_roles',
  'refresh_tokens',
  'accounts',
  'funds',
  'categories',
  'financial_periods',
  'transactions',
  'audit_logs',
  'schema_migrations',
];

describe('migrations', () => {
  it('creates every expected foundation table', async () => {
    const [rows] = await pool.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    );
    const tableNames = rows.map((r) => r.TABLE_NAME);
    for (const table of EXPECTED_TABLES) {
      expect(tableNames).toContain(table);
    }
  });

  it('records every applied migration in schema_migrations', async () => {
    const [rows] = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(rows.length).toBeGreaterThanOrEqual(15);
  });

  it('is idempotent — running up() again applies nothing new', async () => {
    const ran = await up();
    expect(ran).toEqual([]);
  });

  it('every tenant-owned table has a tenant_id column', async () => {
    const tenantOwnedTables = [
      'church_settings',
      'users',
      'accounts',
      'funds',
      'categories',
      'financial_periods',
      'transactions',
    ];
    for (const table of tenantOwnedTables) {
      const [rows] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'tenant_id'`,
        [table]
      );
      expect(rows.length, `${table} should have a tenant_id column`).toBe(1);
    }
  });
});

// Re-run once at module load to prove the runner works when invoked directly,
// independent of the globalSetup call.
beforeAll(async () => {
  await up();
});

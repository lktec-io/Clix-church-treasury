import { describe, it, expect, beforeEach } from 'vitest';
import { pool } from '../../src/config/db.js';
import { resetDatabase } from '../helpers/resetDb.js';
import { createTestTenant, createTestAccount } from '../helpers/fixtures.js';
import { nowSql } from '../../src/db/time.js';

beforeEach(async () => {
  await resetDatabase();
});

describe('foreign key and constraint behavior', () => {
  it('rejects an account referencing a non-existent tenant', async () => {
    await expect(
      pool.query(
        `INSERT INTO accounts (tenant_id, name, type, is_active, created_at, updated_at)
         VALUES (999999, 'Ghost Account', 'cash', TRUE, ?, ?)`,
        [nowSql(), nowSql()]
      )
    ).rejects.toThrow(/foreign key constraint fails/i);
  });

  it('RESTRICTs deleting a tenant that still has accounts', async () => {
    const tenant = await createTestTenant();
    await createTestAccount(tenant.id);

    await expect(pool.query('DELETE FROM tenants WHERE id = ?', [tenant.id])).rejects.toThrow(
      /foreign key constraint fails/i
    );
  });

  it('enforces unique (tenant_id, name) on accounts', async () => {
    const tenant = await createTestTenant();
    await createTestAccount(tenant.id, { name: 'Main Bank' });

    await expect(
      pool.query(
        `INSERT INTO accounts (tenant_id, name, type, is_active, created_at, updated_at)
         VALUES (?, 'Main Bank', 'cash', TRUE, ?, ?)`,
        [tenant.id, nowSql(), nowSql()]
      )
    ).rejects.toThrow(/Duplicate entry/i);
  });

  it('allows two different tenants to reuse the same account name', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    await createTestAccount(tenantA.id, { name: 'Main Bank' });

    await expect(createTestAccount(tenantB.id, { name: 'Main Bank' })).resolves.toBeTruthy();
  });

  it('rejects a financial_period with end_date before start_date', async () => {
    const tenant = await createTestTenant();
    await expect(
      pool.query(
        `INSERT INTO financial_periods (tenant_id, label, start_date, end_date, status, created_at, updated_at)
         VALUES (?, 'Backwards Period', '2026-06-01', '2026-01-01', 'open', ?, ?)`,
        [tenant.id, nowSql(), nowSql()]
      )
    ).rejects.toThrow(/constraint/i);
  });
});

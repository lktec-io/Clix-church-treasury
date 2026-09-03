// Pure-unit coverage for the tenant-deletion guards and the delete-order
// table list. No DB — these assert the pieces that are decidable without
// one, which is exactly the part most likely to rot silently: the table
// list drifting out of sync with the migrations.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TenantsRepository } from '../../src/modules/tenants/tenants.repository.js';
import { validateDeleteTenant } from '../../src/modules/platform/platform.validator.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', '..', 'src', 'db', 'migrations');

// Tables whose tenant-scoped rows disappear via ON DELETE CASCADE from a
// parent the delete order already removes, so they must NOT be listed.
const CASCADED = new Set([
  'contribution_items',
  'contributor_refresh_tokens',
  'user_roles',
  'refresh_tokens',
  'password_reset_tokens',
  'role_permissions',
]);

function tablesWithTenantForeignKey() {
  const found = new Set();
  for (const file of fs.readdirSync(migrationsDir)) {
    if (!file.endsWith('.up.sql')) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    if (!/REFERENCES\s+tenants\s*\(/i.test(sql)) continue;
    // CREATE TABLE x  /  ALTER TABLE x
    for (const m of sql.matchAll(/(?:CREATE TABLE|ALTER TABLE)\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?/gi)) {
      const table = m[1];
      if (table !== 'tenants') found.add(table);
    }
  }
  return found;
}

describe('tenant delete order', () => {
  const order = TenantsRepository.TENANT_TABLES_IN_DELETE_ORDER;

  // The guard that matters most: every one of the 19 ON DELETE RESTRICT
  // foreign keys to tenants must be emptied, or DELETE FROM tenants fails
  // with ER_ROW_IS_REFERENCED_2 and the whole transaction rolls back.
  it('covers every table with a foreign key to tenants', () => {
    const missing = [...tablesWithTenantForeignKey()].filter(
      (table) => !order.includes(table) && !CASCADED.has(table)
    );
    expect(missing).toEqual([]);
  });

  it('lists no table twice', () => {
    expect(new Set(order).size).toBe(order.length);
  });

  it('does not list tables that cascade from a parent already in the list', () => {
    expect(order.filter((table) => CASCADED.has(table))).toEqual([]);
  });

  // Ordering constraints that would produce a foreign-key failure if
  // reversed. Children must be emptied before the rows they point at.
  it.each([
    ['receipts', 'contributions'],
    ['contributions', 'transactions'],
    ['expenses', 'transactions'],
    ['contributions', 'contributors'],
    ['pledges', 'contributors'],
    ['budgets', 'funds'],
    ['transactions', 'accounts'],
    ['transactions', 'funds'],
    ['transactions', 'financial_periods'],
    ['sms_log', 'contributors'],
  ])('deletes %s before %s', (child, parent) => {
    expect(order.indexOf(child)).toBeGreaterThan(-1);
    expect(order.indexOf(parent)).toBeGreaterThan(-1);
    expect(order.indexOf(child)).toBeLessThan(order.indexOf(parent));
  });

  it('empties the tenants table last, and not as part of the list', () => {
    expect(order).not.toContain('tenants');
  });
});

describe('validateDeleteTenant', () => {
  it('rejects a missing or blank confirmation', () => {
    expect(() => validateDeleteTenant({})).toThrow();
    expect(() => validateDeleteTenant({ confirmationSlug: '   ' })).toThrow();
    expect(() => validateDeleteTenant({ confirmationSlug: 123 })).toThrow();
  });

  it('trims and returns a supplied confirmation', () => {
    expect(validateDeleteTenant({ confirmationSlug: '  grace-church  ' })).toEqual({
      confirmationSlug: 'grace-church',
    });
  });
});

describe('hardDeleteWithAllData', () => {
  // Running outside a transaction could leave a tenant with half its data
  // destroyed — worse than either completing or not starting.
  it('refuses to run without a transaction connection', async () => {
    const repo = new TenantsRepository();
    await expect(repo.hardDeleteWithAllData(1)).rejects.toThrow(/transaction connection/i);
  });
});

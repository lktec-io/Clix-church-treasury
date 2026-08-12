import bcrypt from 'bcryptjs';
import { createTenant } from '../../src/modules/tenants/tenants.service.js';
import { accountsRepository } from '../../src/modules/accounts/accounts.repository.js';
import { fundsRepository } from '../../src/modules/funds/funds.repository.js';
import { usersRepository } from '../../src/modules/users/users.repository.js';
import { rolesRepository } from '../../src/modules/roles/roles.repository.js';
import { seedRbacCatalog } from '../../src/db/seeds/seedRbacCatalog.js';
import { categoriesRepository } from '../../src/modules/categories/categories.repository.js';
import { financialPeriodsRepository } from '../../src/modules/financial/financialPeriods.repository.js';
import { contributorsRepository } from '../../src/modules/contributors/contributors.repository.js';
import { pool } from '../../src/config/db.js';

let counter = 0;

export function uniqueName(prefix) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export async function createTestTenant(name = uniqueName('Test Church')) {
  return createTenant({ name });
}

// Real, DB-backed user + role assignment — needed because RBAC middleware
// (Phase 2) re-derives permissions from the database on every request, so a
// purely in-memory fake-auth identity with no matching user row gets 403'd.
export async function createTestUserWithRole(tenantId, roleName = 'Super Administrator') {
  await seedRbacCatalog(); // idempotent
  const passwordHash = await bcrypt.hash('irrelevant-for-these-tests', 4);
  const user = await usersRepository.create(tenantId, {
    email: `${uniqueName('user')}@example.test`,
    passwordHash,
    fullName: 'Test User',
    status: 'active',
  });
  const role = await rolesRepository.findSystemRoleByName(roleName);
  await pool.query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [user.id, role.id]);
  return user;
}

export async function createTestAccount(tenantId, overrides = {}) {
  return accountsRepository.create(tenantId, {
    name: uniqueName('Account'),
    type: 'cash',
    ...overrides,
  });
}

export async function createTestFund(tenantId, overrides = {}) {
  return fundsRepository.create(tenantId, {
    name: uniqueName('Fund'),
    isRestricted: false,
    ...overrides,
  });
}

export async function createTestCategory(tenantId, overrides = {}) {
  return categoriesRepository.create(tenantId, {
    type: 'income',
    name: uniqueName('Category'),
    ...overrides,
  });
}

export async function createTestOpenPeriod(tenantId, overrides = {}) {
  return financialPeriodsRepository.create(tenantId, {
    label: uniqueName('Period'),
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    ...overrides,
  });
}

export async function createTestContributor(tenantId, overrides = {}) {
  return contributorsRepository.create(tenantId, {
    fullName: uniqueName('Contributor'),
    ...overrides,
  });
}

// Bundles account + fund + open period, the trio every ledger posting needs.
export async function createFinancialFixtures(tenantId) {
  const account = await createTestAccount(tenantId);
  const fund = await createTestFund(tenantId);
  const period = await createTestOpenPeriod(tenantId);
  const incomeCategory = await createTestCategory(tenantId, { type: 'income' });
  const expenseCategory = await createTestCategory(tenantId, { type: 'expense' });
  return { account, fund, period, incomeCategory, expenseCategory };
}

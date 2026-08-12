import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase } from '../helpers/resetDb.js';
import { createTestTenant, createTestAccount, createTestFund } from '../helpers/fixtures.js';
import { accountsRepository } from '../../src/modules/accounts/accounts.repository.js';
import { fundsRepository } from '../../src/modules/funds/funds.repository.js';

beforeEach(async () => {
  await resetDatabase();
});

describe('tenant isolation — repository layer', () => {
  it('tenant A can access tenant A data', async () => {
    const tenantA = await createTestTenant();
    const account = await createTestAccount(tenantA.id);

    const found = await accountsRepository.findById(tenantA.id, account.id);
    expect(found).not.toBeNull();
    expect(found.id).toBe(account.id);
  });

  it('tenant A cannot access tenant B data by id', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const bAccount = await createTestAccount(tenantB.id);

    const found = await accountsRepository.findById(tenantA.id, bAccount.id);
    expect(found).toBeNull();
  });

  it('tenant B cannot access tenant A data by id (symmetry check)', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const aAccount = await createTestAccount(tenantA.id);

    const found = await accountsRepository.findById(tenantB.id, aAccount.id);
    expect(found).toBeNull();
  });

  it('a cross-tenant id cannot be used to update another tenant\'s row', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const bAccount = await createTestAccount(tenantB.id);

    const result = await accountsRepository.update(tenantA.id, bAccount.id, { name: 'Hijacked' });
    expect(result).toBeNull();

    const stillOriginal = await accountsRepository.findById(tenantB.id, bAccount.id);
    expect(stillOriginal.name).toBe(bAccount.name);
  });

  it('findAllByTenant never returns another tenant\'s rows', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    await createTestAccount(tenantA.id);
    await createTestAccount(tenantA.id);
    await createTestAccount(tenantB.id);

    const aAccounts = await accountsRepository.findAllByTenant(tenantA.id);
    expect(aAccounts).toHaveLength(2);
    expect(aAccounts.every((a) => a.tenant_id === tenantA.id)).toBe(true);
  });

  it('missing tenant context is rejected, not silently treated as unscoped', async () => {
    await expect(accountsRepository.findAllByTenant(undefined)).rejects.toThrow(
      /tenantId is required/
    );
    await expect(accountsRepository.findAllByTenant(null)).rejects.toThrow(/tenantId is required/);
  });

  it('the same isolation holds for a second tenant-scoped module (funds)', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const bFund = await createTestFund(tenantB.id);

    const found = await fundsRepository.findById(tenantA.id, bFund.id);
    expect(found).toBeNull();
  });
});

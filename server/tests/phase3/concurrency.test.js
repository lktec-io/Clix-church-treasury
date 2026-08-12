import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase } from '../helpers/resetDb.js';
import { createTestTenant, createFinancialFixtures, createTestUserWithRole } from '../helpers/fixtures.js';
import * as engine from '../../src/modules/financial/financialEngine.service.js';

beforeEach(async () => {
  await resetDatabase();
});

describe('financial engine — concurrency', () => {
  it('50 concurrent income postings all succeed with unique transaction numbers and a correct summed balance', async () => {
    const tenant = await createTestTenant();
    const { account, fund, period } = await createFinancialFixtures(tenant.id);
    const user = await createTestUserWithRole(tenant.id);

    const CONCURRENT_COUNT = 50;
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_COUNT }, () =>
        engine.recordSimpleTransaction(tenant.id, {
          type: 'income',
          accountId: account.id,
          fundId: fund.id,
          financialPeriodId: period.id,
          amount: '1.00',
          createdByUserId: user.id,
        })
      )
    );

    const uniqueNumbers = new Set(results.map((r) => r.transaction_number));
    expect(uniqueNumbers.size).toBe(CONCURRENT_COUNT);
    expect(await engine.getAccountBalance(tenant.id, account.id)).toBe(`${CONCURRENT_COUNT}.00`);
  });

  it('concurrent transfers between the same two accounts leave the total balance unchanged', async () => {
    const tenant = await createTestTenant();
    const { account: accountA, fund, period } = await createFinancialFixtures(tenant.id);
    const { account: accountB } = await createFinancialFixtures(tenant.id);
    const user = await createTestUserWithRole(tenant.id);

    await engine.recordSimpleTransaction(tenant.id, {
      type: 'income',
      accountId: accountA.id,
      fundId: fund.id,
      financialPeriodId: period.id,
      amount: '1000.00',
      createdByUserId: user.id,
    });

    const totalBefore = await engine.getTotalBalance(tenant.id);

    await Promise.all(
      Array.from({ length: 10 }, () =>
        engine.transfer(tenant.id, {
          fromAccountId: accountA.id,
          toAccountId: accountB.id,
          fromFundId: fund.id,
          toFundId: fund.id,
          amount: '10.00',
          createdByUserId: user.id,
          financialPeriodId: period.id,
        })
      )
    );

    const totalAfter = await engine.getTotalBalance(tenant.id);
    expect(totalAfter).toBe(totalBefore);
    expect(await engine.getAccountBalance(tenant.id, accountB.id)).toBe('100.00');
    expect(await engine.getAccountBalance(tenant.id, accountA.id)).toBe('900.00');
  });
});

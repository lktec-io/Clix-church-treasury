import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase } from '../helpers/resetDb.js';
import { createTestTenant, createFinancialFixtures, createTestUserWithRole } from '../helpers/fixtures.js';
import * as engine from '../../src/modules/financial/financialEngine.service.js';
import { financialPeriodsRepository } from '../../src/modules/financial/financialPeriods.repository.js';
import { closePeriod } from '../../src/modules/financial/financialPeriods.service.js';

beforeEach(async () => {
  await resetDatabase();
});

async function setup() {
  const tenant = await createTestTenant();
  const fixtures = await createFinancialFixtures(tenant.id);
  const user = await createTestUserWithRole(tenant.id);
  return { tenant, ...fixtures, user };
}

describe('financial engine — balances', () => {
  it('a new account/fund has a zero opening balance', async () => {
    const { tenant, account, fund } = await setup();
    expect(await engine.getAccountBalance(tenant.id, account.id)).toBe('0.00');
    expect(await engine.getFundBalance(tenant.id, fund.id)).toBe('0.00');
  });

  it('income increases the account and fund balance', async () => {
    const { tenant, account, fund, period, incomeCategory, user } = await setup();
    await engine.recordSimpleTransaction(tenant.id, {
      type: 'income',
      accountId: account.id,
      fundId: fund.id,
      categoryId: incomeCategory.id,
      financialPeriodId: period.id,
      amount: '150.00',
      createdByUserId: user.id,
    });

    expect(await engine.getAccountBalance(tenant.id, account.id)).toBe('150.00');
    expect(await engine.getFundBalance(tenant.id, fund.id)).toBe('150.00');
  });

  it('expense decreases the account and fund balance', async () => {
    const { tenant, account, fund, period, expenseCategory, user } = await setup();
    await engine.recordSimpleTransaction(tenant.id, {
      type: 'income',
      accountId: account.id,
      fundId: fund.id,
      financialPeriodId: period.id,
      amount: '500.00',
      createdByUserId: user.id,
    });
    await engine.recordSimpleTransaction(tenant.id, {
      type: 'expense',
      accountId: account.id,
      fundId: fund.id,
      categoryId: expenseCategory.id,
      financialPeriodId: period.id,
      amount: '120.00',
      createdByUserId: user.id,
    });

    expect(await engine.getAccountBalance(tenant.id, account.id)).toBe('380.00');
  });

  it('multiple transactions across income and expense sum correctly', async () => {
    const { tenant, account, fund, period, user } = await setup();
    const amounts = [
      ['income', '100.00'],
      ['income', '250.50'],
      ['expense', '30.25'],
      ['income', '10.00'],
      ['expense', '5.75'],
    ];
    for (const [type, amount] of amounts) {
      await engine.recordSimpleTransaction(tenant.id, {
        type,
        accountId: account.id,
        fundId: fund.id,
        financialPeriodId: period.id,
        amount,
        createdByUserId: user.id,
      });
    }
    // 100 + 250.50 - 30.25 + 10 - 5.75 = 324.50
    expect(await engine.getAccountBalance(tenant.id, account.id)).toBe('324.50');
  });

  it('getAccountBalance matches an independent sum of getTransactionHistory rows', async () => {
    const { tenant, account, fund, period, user } = await setup();
    for (const [type, amount] of [['income', '77.77'], ['expense', '12.12'], ['income', '5.00']]) {
      await engine.recordSimpleTransaction(tenant.id, {
        type,
        accountId: account.id,
        fundId: fund.id,
        financialPeriodId: period.id,
        amount,
        createdByUserId: user.id,
      });
    }
    const history = await engine.getTransactionHistory(tenant.id, { accountId: account.id, limit: 100 });
    const manualSumCents = history.reduce((sum, row) => {
      const cents = Math.round(Number(row.amount) * 100);
      return row.direction === 'in' ? sum + cents : sum - cents;
    }, 0);
    const engineBalanceCents = Math.round(Number(await engine.getAccountBalance(tenant.id, account.id)) * 100);
    expect(manualSumCents).toBe(engineBalanceCents);
  });
});

describe('financial engine — transfers', () => {
  it('decreases the source account and increases the destination account by the same amount', async () => {
    const { tenant, account, fund, period, user } = await setup();
    const destAccount = (await createFinancialFixtures(tenant.id)).account;

    await engine.recordSimpleTransaction(tenant.id, {
      type: 'income',
      accountId: account.id,
      fundId: fund.id,
      financialPeriodId: period.id,
      amount: '1000.00',
      createdByUserId: user.id,
    });

    await engine.transfer(tenant.id, {
      fromAccountId: account.id,
      toAccountId: destAccount.id,
      fromFundId: fund.id,
      toFundId: fund.id,
      amount: '400.00',
      description: 'Move to savings',
      createdByUserId: user.id,
      financialPeriodId: period.id,
    });

    expect(await engine.getAccountBalance(tenant.id, account.id)).toBe('600.00');
    expect(await engine.getAccountBalance(tenant.id, destAccount.id)).toBe('400.00');
  });

  it('does not change the tenant total balance', async () => {
    const { tenant, account, fund, period, user } = await setup();
    const destAccount = (await createFinancialFixtures(tenant.id)).account;

    await engine.recordSimpleTransaction(tenant.id, {
      type: 'income',
      accountId: account.id,
      fundId: fund.id,
      financialPeriodId: period.id,
      amount: '1000.00',
      createdByUserId: user.id,
    });

    const totalBefore = await engine.getTotalBalance(tenant.id);
    await engine.transfer(tenant.id, {
      fromAccountId: account.id,
      toAccountId: destAccount.id,
      fromFundId: fund.id,
      toFundId: fund.id,
      amount: '400.00',
      createdByUserId: user.id,
      financialPeriodId: period.id,
    });
    const totalAfter = await engine.getTotalBalance(tenant.id);

    expect(totalAfter).toBe(totalBefore);
  });

  it('never posts as type income or expense', async () => {
    const { tenant, account, fund, period, user } = await setup();
    const destAccount = (await createFinancialFixtures(tenant.id)).account;
    const { outLeg, inLeg } = await engine.transfer(tenant.id, {
      fromAccountId: account.id,
      toAccountId: destAccount.id,
      fromFundId: fund.id,
      toFundId: fund.id,
      amount: '50.00',
      createdByUserId: user.id,
      financialPeriodId: period.id,
    });
    expect(outLeg.type).toBe('transfer');
    expect(inLeg.type).toBe('transfer');
    expect(await engine.getIncomeTotals(tenant.id)).toBe('0.00');
    expect(await engine.getExpenseTotals(tenant.id)).toBe('0.00');
  });

  it('rejects a transfer to the exact same account and fund (no-op)', async () => {
    const { tenant, account, fund, period, user } = await setup();
    await expect(
      engine.transfer(tenant.id, {
        fromAccountId: account.id,
        toAccountId: account.id,
        fromFundId: fund.id,
        toFundId: fund.id,
        amount: '10.00',
        createdByUserId: user.id,
        financialPeriodId: period.id,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rolls back both legs if the destination account is invalid', async () => {
    const { tenant, account, fund, period, user } = await setup();

    await expect(
      engine.transfer(tenant.id, {
        fromAccountId: account.id,
        toAccountId: 999999,
        fromFundId: fund.id,
        toFundId: fund.id,
        amount: '10.00',
        createdByUserId: user.id,
        financialPeriodId: period.id,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // Neither leg should have been left behind.
    const history = await engine.getTransactionHistory(tenant.id, { accountId: account.id });
    expect(history).toHaveLength(0);
    expect(await engine.getAccountBalance(tenant.id, account.id)).toBe('0.00');
  });
});

describe('financial engine — reversals', () => {
  it('exactly cancels the financial effect of the original transaction', async () => {
    const { tenant, account, fund, period, user } = await setup();
    const original = await engine.recordSimpleTransaction(tenant.id, {
      type: 'income',
      accountId: account.id,
      fundId: fund.id,
      financialPeriodId: period.id,
      amount: '200.00',
      createdByUserId: user.id,
    });

    expect(await engine.getAccountBalance(tenant.id, account.id)).toBe('200.00');

    await engine.reverseTransaction(tenant.id, original.id, { reason: 'Recorded in error', createdByUserId: user.id });

    expect(await engine.getAccountBalance(tenant.id, account.id)).toBe('0.00');
  });

  it('leaves the original row intact and marks it reversed, rather than deleting it', async () => {
    const { tenant, account, fund, period, user } = await setup();
    const original = await engine.recordSimpleTransaction(tenant.id, {
      type: 'expense',
      accountId: account.id,
      fundId: fund.id,
      financialPeriodId: period.id,
      amount: '75.00',
      createdByUserId: user.id,
    });

    const reversal = await engine.reverseTransaction(tenant.id, original.id, {
      reason: 'Duplicate entry',
      createdByUserId: user.id,
    });

    const history = await engine.getTransactionHistory(tenant.id, { accountId: account.id });
    const originalRow = history.find((t) => t.id === original.id);
    expect(originalRow.status).toBe('reversed');
    expect(originalRow.reversed_by_transaction_id).toBe(reversal.id);
    expect(originalRow.amount).toBe(original.amount); // untouched
    expect(reversal.type).toBe('reversal');
    expect(reversal.direction).toBe('in'); // opposite of the expense's 'out'
  });

  it('cannot reverse the same transaction twice', async () => {
    const { tenant, account, fund, period, user } = await setup();
    const original = await engine.recordSimpleTransaction(tenant.id, {
      type: 'income',
      accountId: account.id,
      fundId: fund.id,
      financialPeriodId: period.id,
      amount: '90.00',
      createdByUserId: user.id,
    });
    await engine.reverseTransaction(tenant.id, original.id, { reason: 'first', createdByUserId: user.id });

    await expect(
      engine.reverseTransaction(tenant.id, original.id, { reason: 'second', createdByUserId: user.id })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('cannot reverse a transaction that is still a draft/not posted', async () => {
    const { tenant, account, fund, period, user } = await setup();
    // Force a non-posted row directly to test the guard (nothing in the
    // public API can create one, which is itself the point).
    const { transactionsRepository } = await import('../../src/modules/financial/transactions.repository.js');
    const fakeDraft = await transactionsRepository.insert(tenant.id, {
      transaction_number: 'TXN-TEST-DRAFT',
      type: 'income',
      direction: 'in',
      account_id: account.id,
      fund_id: fund.id,
      financial_period_id: period.id,
      amount: '10.00',
      status: 'draft',
      created_by_user_id: user.id,
    });

    await expect(
      engine.reverseTransaction(tenant.id, fakeDraft.id, { reason: 'x', createdByUserId: user.id })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('financial engine — adjustments', () => {
  it('posts a standalone correction that affects the balance', async () => {
    const { tenant, account, fund, period, user } = await setup();
    await engine.createAdjustment(tenant.id, {
      accountId: account.id,
      fundId: fund.id,
      categoryId: null,
      direction: 'in',
      amount: '15.00',
      description: 'Bank reconciliation difference',
      createdByUserId: user.id,
      financialPeriodId: period.id,
    });
    expect(await engine.getAccountBalance(tenant.id, account.id)).toBe('15.00');
  });

  it('requires a reason', async () => {
    const { tenant, account, fund, period, user } = await setup();
    await expect(
      engine.createAdjustment(tenant.id, {
        accountId: account.id,
        fundId: fund.id,
        direction: 'in',
        amount: '15.00',
        description: '',
        createdByUserId: user.id,
        financialPeriodId: period.id,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('is a distinct transaction type from a reversal', async () => {
    const { tenant, account, fund, period, user } = await setup();
    const adjustment = await engine.createAdjustment(tenant.id, {
      accountId: account.id,
      fundId: fund.id,
      direction: 'out',
      amount: '5.00',
      description: 'Bank fee not previously recorded',
      createdByUserId: user.id,
      financialPeriodId: period.id,
    });
    expect(adjustment.type).toBe('adjustment');
  });
});

describe('financial engine — financial periods', () => {
  it('rejects posting against a closed period', async () => {
    const { tenant, account, fund, period, user } = await setup();
    await closePeriod(tenant.id, period.id, user.id);

    await expect(
      engine.recordSimpleTransaction(tenant.id, {
        type: 'income',
        accountId: account.id,
        fundId: fund.id,
        financialPeriodId: period.id,
        amount: '10.00',
        createdByUserId: user.id,
      })
    ).rejects.toMatchObject({ code: 'PERIOD_LOCKED' });
  });

  it('a reversal posts against the current open period even if the original period is closed', async () => {
    const { tenant, account, fund, period, user } = await setup();
    const original = await engine.recordSimpleTransaction(tenant.id, {
      type: 'income',
      accountId: account.id,
      fundId: fund.id,
      financialPeriodId: period.id,
      amount: '60.00',
      createdByUserId: user.id,
    });

    await closePeriod(tenant.id, period.id, user.id);
    const newPeriod = await financialPeriodsRepository.create(tenant.id, {
      label: 'Next Period',
      startDate: '2027-01-01',
      endDate: '2027-12-31',
    });

    const reversal = await engine.reverseTransaction(tenant.id, original.id, {
      reason: 'correcting after close',
      createdByUserId: user.id,
    });
    expect(reversal.financial_period_id).toBe(newPeriod.id);
  });
});

describe('financial engine — validation', () => {
  it('rejects a negative amount', async () => {
    const { tenant, account, fund, period, user } = await setup();
    await expect(
      engine.recordSimpleTransaction(tenant.id, {
        type: 'income',
        accountId: account.id,
        fundId: fund.id,
        financialPeriodId: period.id,
        amount: '-10.00',
        createdByUserId: user.id,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a zero amount', async () => {
    const { tenant, account, fund, period, user } = await setup();
    await expect(
      engine.recordSimpleTransaction(tenant.id, {
        type: 'expense',
        accountId: account.id,
        fundId: fund.id,
        financialPeriodId: period.id,
        amount: '0.00',
        createdByUserId: user.id,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a non-string (JS number) amount to avoid floating-point money', async () => {
    const { tenant, account, fund, period, user } = await setup();
    await expect(
      engine.recordSimpleTransaction(tenant.id, {
        type: 'income',
        accountId: account.id,
        fundId: fund.id,
        financialPeriodId: period.id,
        amount: 10.5,
        createdByUserId: user.id,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects more than 2 decimal places', async () => {
    const { tenant, account, fund, period, user } = await setup();
    await expect(
      engine.recordSimpleTransaction(tenant.id, {
        type: 'income',
        accountId: account.id,
        fundId: fund.id,
        financialPeriodId: period.id,
        amount: '10.123',
        createdByUserId: user.id,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects an inactive account', async () => {
    const { tenant, account, fund, period, user } = await setup();
    const { accountsRepository } = await import('../../src/modules/accounts/accounts.repository.js');
    await accountsRepository.update(tenant.id, account.id, { is_active: false });

    await expect(
      engine.recordSimpleTransaction(tenant.id, {
        type: 'income',
        accountId: account.id,
        fundId: fund.id,
        financialPeriodId: period.id,
        amount: '10.00',
        createdByUserId: user.id,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a transaction type other than income/expense via recordSimpleTransaction', async () => {
    const { tenant, account, fund, period, user } = await setup();
    await expect(
      engine.recordSimpleTransaction(tenant.id, {
        type: 'transfer',
        accountId: account.id,
        fundId: fund.id,
        financialPeriodId: period.id,
        amount: '10.00',
        createdByUserId: user.id,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('financial engine — tenant isolation', () => {
  it('rejects posting against another tenant\'s account', async () => {
    const { tenant: tenantA, fund, period, user } = await setup();
    const tenantB = await createTestTenant();
    const { account: bAccount } = await createFinancialFixtures(tenantB.id);

    await expect(
      engine.recordSimpleTransaction(tenantA.id, {
        type: 'income',
        accountId: bAccount.id, // belongs to tenant B
        fundId: fund.id,
        financialPeriodId: period.id,
        amount: '10.00',
        createdByUserId: user.id,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects reversing another tenant\'s transaction', async () => {
    const { tenant: tenantA } = await setup();
    const tenantB = await createTestTenant();
    const fixturesB = await createFinancialFixtures(tenantB.id);
    const userB = await createTestUserWithRole(tenantB.id);

    const bTransaction = await engine.recordSimpleTransaction(tenantB.id, {
      type: 'income',
      accountId: fixturesB.account.id,
      fundId: fixturesB.fund.id,
      financialPeriodId: fixturesB.period.id,
      amount: '10.00',
      createdByUserId: userB.id,
    });

    await expect(
      engine.reverseTransaction(tenantA.id, bTransaction.id, { reason: 'x', createdByUserId: userB.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('one tenant\'s transactions never affect another tenant\'s balance', async () => {
    const { tenant: tenantA, account: aAccount, fund: aFund, period: aPeriod, user: userA } = await setup();
    const tenantB = await createTestTenant();
    const fixturesB = await createFinancialFixtures(tenantB.id);
    const userB = await createTestUserWithRole(tenantB.id);

    await engine.recordSimpleTransaction(tenantA.id, {
      type: 'income',
      accountId: aAccount.id,
      fundId: aFund.id,
      financialPeriodId: aPeriod.id,
      amount: '999.00',
      createdByUserId: userA.id,
    });
    await engine.recordSimpleTransaction(tenantB.id, {
      type: 'income',
      accountId: fixturesB.account.id,
      fundId: fixturesB.fund.id,
      financialPeriodId: fixturesB.period.id,
      amount: '1.00',
      createdByUserId: userB.id,
    });

    expect(await engine.getAccountBalance(tenantB.id, fixturesB.account.id)).toBe('1.00');
    expect(await engine.getTotalBalance(tenantB.id)).toBe('1.00');
  });
});

describe('financial engine — duplicate transaction numbers', () => {
  it('the database rejects two transactions with the same tenant + transaction_number', async () => {
    const { tenant, account, fund, period, user } = await setup();
    const { transactionsRepository } = await import('../../src/modules/financial/transactions.repository.js');

    await transactionsRepository.insert(tenant.id, {
      transaction_number: 'TXN-FIXED-0001',
      type: 'income',
      direction: 'in',
      account_id: account.id,
      fund_id: fund.id,
      financial_period_id: period.id,
      amount: '10.00',
      status: 'posted',
      created_by_user_id: user.id,
    });

    await expect(
      transactionsRepository.insert(tenant.id, {
        transaction_number: 'TXN-FIXED-0001',
        type: 'income',
        direction: 'in',
        account_id: account.id,
        fund_id: fund.id,
        financial_period_id: period.id,
        amount: '20.00',
        status: 'posted',
        created_by_user_id: user.id,
      })
    ).rejects.toThrow(/Duplicate entry/i);
  });

  it('two different tenants may reuse the same transaction_number', async () => {
    const { tenant: tenantA, account, fund, period, user } = await setup();
    const tenantB = await createTestTenant();
    const fixturesB = await createFinancialFixtures(tenantB.id);
    const userB = await createTestUserWithRole(tenantB.id);
    const { transactionsRepository } = await import('../../src/modules/financial/transactions.repository.js');

    await transactionsRepository.insert(tenantA.id, {
      transaction_number: 'TXN-SHARED-0001',
      type: 'income',
      direction: 'in',
      account_id: account.id,
      fund_id: fund.id,
      financial_period_id: period.id,
      amount: '10.00',
      status: 'posted',
      created_by_user_id: user.id,
    });

    await expect(
      transactionsRepository.insert(tenantB.id, {
        transaction_number: 'TXN-SHARED-0001',
        type: 'income',
        direction: 'in',
        account_id: fixturesB.account.id,
        fund_id: fixturesB.fund.id,
        financial_period_id: fixturesB.period.id,
        amount: '10.00',
        status: 'posted',
        created_by_user_id: userB.id,
      })
    ).resolves.toBeTruthy();
  });
});

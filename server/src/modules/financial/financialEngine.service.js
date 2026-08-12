import { withTransaction } from '../../config/db.js';
import { nowSql } from '../../db/time.js';
import { AppError, notFound, validationError } from '../../errors/AppError.js';
import { transactionsRepository } from './transactions.repository.js';
import { accountsRepository } from '../accounts/accounts.repository.js';
import { fundsRepository } from '../funds/funds.repository.js';
import { categoriesRepository } from '../categories/categories.repository.js';
import { assertPeriodOpenAndOwned, getOpenPeriod } from './financialPeriods.service.js';
import { generateTransactionNumber } from './transactionNumber.js';
import { isPositiveMoneyString } from './money.js';
import { recordAuditLog } from '../audit/auditLog.service.js';

const POSTABLE_TYPES = ['income', 'expense', 'transfer', 'reversal', 'adjustment'];
const MAX_TRANSACTION_NUMBER_ATTEMPTS = 5;

async function assertAccountUsable(tenantId, accountId, connection) {
  const account = await accountsRepository.findById(tenantId, accountId, connection);
  if (!account || !account.is_active) {
    throw validationError('Invalid account', { accountId: 'must reference an active account owned by this tenant' });
  }
  return account;
}

async function assertFundUsable(tenantId, fundId, connection) {
  const fund = await fundsRepository.findById(tenantId, fundId, connection);
  if (!fund || !fund.is_active) {
    throw validationError('Invalid fund', { fundId: 'must reference an active fund owned by this tenant' });
  }
  return fund;
}

async function assertCategoryUsable(tenantId, categoryId, connection) {
  if (categoryId === null || categoryId === undefined) return null;
  const category = await categoriesRepository.findById(tenantId, categoryId, connection);
  if (!category || !category.is_active) {
    throw validationError('Invalid category', {
      categoryId: 'must reference an active category owned by this tenant',
    });
  }
  return category;
}

// Inserts one ledger row. This is the ONLY function in the codebase that
// INSERTs into `transactions` — every domain module (income, expenses,
// transfers, reversals, adjustments) posts through this
// (docs/FINANCIAL_ARCHITECTURE.md §1, §6). Always runs inside the caller's
// transaction — never opens its own, so multi-row postings (transfer,
// reversal) stay atomic.
async function insertLedgerRow(connection, tenantId, entry) {
  if (!POSTABLE_TYPES.includes(entry.type)) {
    throw validationError('Invalid transaction type', { type: `must be one of: ${POSTABLE_TYPES.join(', ')}` });
  }
  if (!['in', 'out'].includes(entry.direction)) {
    throw validationError('Invalid direction', { direction: 'must be "in" or "out"' });
  }
  if (!isPositiveMoneyString(entry.amount)) {
    throw validationError('Invalid amount', { amount: 'must be a positive decimal string with at most 2 places' });
  }

  await assertAccountUsable(tenantId, entry.accountId, connection);
  await assertFundUsable(tenantId, entry.fundId, connection);
  await assertCategoryUsable(tenantId, entry.categoryId ?? null, connection);
  await assertPeriodOpenAndOwned(tenantId, entry.financialPeriodId, connection);

  for (let attempt = 0; attempt < MAX_TRANSACTION_NUMBER_ATTEMPTS; attempt += 1) {
    const transactionNumber = generateTransactionNumber();
    try {
      return await transactionsRepository.insert(
        tenantId,
        {
          transaction_number: transactionNumber,
          type: entry.type,
          direction: entry.direction,
          account_id: entry.accountId,
          fund_id: entry.fundId,
          category_id: entry.categoryId ?? null,
          financial_period_id: entry.financialPeriodId,
          amount: entry.amount,
          payment_method: entry.paymentMethod ?? null,
          reference_type: entry.referenceType ?? null,
          reference_id: entry.referenceId ?? null,
          description: entry.description ?? null,
          status: 'posted',
          posted_at: nowSql(),
          created_by_user_id: entry.createdByUserId,
        },
        connection
      );
    } catch (error) {
      // Duplicate transaction_number (astronomically unlikely, but the DB
      // constraint plus this retry is what makes it *impossible*, not just
      // unlikely, per docs/MASTER_TODO.md Phase 3's "duplicate transaction
      // number is rejected" requirement).
      const isDuplicateNumber = error.code === 'ER_DUP_ENTRY' && error.message.includes('uq_transactions_tenant_number');
      if (!isDuplicateNumber || attempt === MAX_TRANSACTION_NUMBER_ATTEMPTS - 1) throw error;
    }
  }
  throw new AppError('INTERNAL_ERROR', 'Could not generate a unique transaction number', { status: 500 });
}

// Records income or an expense as a single posted ledger row. Callers
// (Phase 4/5 domain services) are expected to have already resolved
// approval-gating (docs/FINANCIAL_ARCHITECTURE.md §8) before calling this —
// this function always posts immediately, it does not manage a draft state.
export async function recordSimpleTransaction(tenantId, entry) {
  const direction = entry.type === 'income' ? 'in' : 'out';
  if (entry.type !== 'income' && entry.type !== 'expense') {
    throw validationError('Invalid type', { type: 'recordSimpleTransaction only accepts income or expense' });
  }
  return withTransaction((connection) => insertLedgerRow(connection, tenantId, { ...entry, direction }));
}

// A transfer never appears as ordinary income/expense (type='transfer' on
// both legs) and cannot change the tenant's total money — the two legs post
// equal-and-opposite amounts, so summing across every account cancels them
// out by construction (docs/FINANCIAL_ARCHITECTURE.md — transfer rule).
export async function transfer(tenantId, {
  fromAccountId, toAccountId, fromFundId, toFundId, amount, description, createdByUserId, financialPeriodId,
}) {
  if (fromAccountId === toAccountId && fromFundId === toFundId) {
    throw validationError('Invalid transfer', {
      toAccountId: 'a transfer must move money to a different account or a different fund',
    });
  }

  return withTransaction(async (connection) => {
    const periodId = financialPeriodId ?? (await getOpenPeriod(tenantId, connection))?.id;
    if (!periodId) throw notFound('No open financial period to post the transfer against');

    const outLeg = await insertLedgerRow(connection, tenantId, {
      type: 'transfer',
      direction: 'out',
      accountId: fromAccountId,
      fundId: fromFundId,
      financialPeriodId: periodId,
      amount,
      description,
      referenceType: 'transfer',
      createdByUserId,
    });

    const inLeg = await insertLedgerRow(connection, tenantId, {
      type: 'transfer',
      direction: 'in',
      accountId: toAccountId,
      fundId: toFundId,
      financialPeriodId: periodId,
      amount,
      description,
      referenceType: 'transfer',
      referenceId: outLeg.id,
      createdByUserId,
    });

    // The only sanctioned post-insert mutation of a posted row: linking the
    // two legs to each other via reference_id. This never touches amount,
    // direction, account, fund, or status — the values that matter for
    // balance integrity are set once at insert and never revisited.
    await transactionsRepository.update(tenantId, outLeg.id, { reference_id: inLeg.id }, connection);

    return { outLeg: { ...outLeg, reference_id: inLeg.id }, inLeg };
  });
}

// Corrects a posted transaction by creating a new, equal-and-opposite entry
// — the original is never edited or deleted (docs/FINANCIAL_ARCHITECTURE.md §4).
export async function reverseTransaction(tenantId, originalTransactionId, { reason, createdByUserId }) {
  return withTransaction(async (connection) => {
    const original = await transactionsRepository.findById(tenantId, originalTransactionId, connection);
    if (!original) throw notFound('Transaction not found');
    if (original.status !== 'posted') {
      throw new AppError('CONFLICT', 'Only a posted transaction can be reversed', { status: 409 });
    }
    if (original.reversed_by_transaction_id) {
      throw new AppError('CONFLICT', 'This transaction has already been reversed', { status: 409 });
    }

    // A reversal is dated today and posts against today's open period, even
    // if the original transaction's period has since closed — you cannot
    // post anything, including a correction, into a closed period.
    const openPeriod = await getOpenPeriod(tenantId, connection);
    if (!openPeriod) throw notFound('No open financial period to post the reversal against');

    const reversal = await insertLedgerRow(connection, tenantId, {
      type: 'reversal',
      direction: original.direction === 'in' ? 'out' : 'in',
      accountId: original.account_id,
      fundId: original.fund_id,
      categoryId: original.category_id,
      financialPeriodId: openPeriod.id,
      amount: original.amount,
      description: reason,
      referenceType: 'transactions',
      referenceId: original.id,
      createdByUserId,
    });

    await transactionsRepository.update(
      tenantId,
      original.id,
      { status: 'reversed', reversed_by_transaction_id: reversal.id },
      connection
    );

    await recordAuditLog(
      {
        tenantId,
        actorUserId: createdByUserId,
        action: 'transaction.reversed',
        entityType: 'transactions',
        entityId: original.id,
        before: { status: original.status },
        after: { status: 'reversed', reversalId: reversal.id, reason },
      },
      connection
    );

    return reversal;
  });
}

// A reconciliation correction, distinct from a reversal — see
// docs/FINANCIAL_ARCHITECTURE.md §4. Not tied to a specific prior transaction.
export async function createAdjustment(tenantId, {
  accountId, fundId, categoryId, direction, amount, description, createdByUserId, financialPeriodId,
}) {
  if (!description || description.trim().length === 0) {
    throw validationError('Invalid adjustment', { description: 'a reason is required for every adjustment' });
  }
  return withTransaction(async (connection) => {
    const periodId = financialPeriodId ?? (await getOpenPeriod(tenantId, connection))?.id;
    if (!periodId) throw notFound('No open financial period to post the adjustment against');

    const adjustment = await insertLedgerRow(connection, tenantId, {
      type: 'adjustment',
      direction,
      accountId,
      fundId,
      categoryId,
      financialPeriodId: periodId,
      amount,
      description,
      createdByUserId,
    });

    await recordAuditLog(
      {
        tenantId,
        actorUserId: createdByUserId,
        action: 'transaction.adjustment_created',
        entityType: 'transactions',
        entityId: adjustment.id,
        after: { amount, direction, description },
      },
      connection
    );

    return adjustment;
  });
}

// --- Reporting-foundation query methods (docs/MASTER_TODO.md Phase 3 §Reporting Foundation) ---
// Every future report/dashboard calls these — never re-derives a total with
// its own SQL (docs/FINANCIAL_ARCHITECTURE.md §6).

export async function getAccountBalance(tenantId, accountId) {
  return transactionsRepository.sumSigned(tenantId, { accountId });
}

export async function getFundBalance(tenantId, fundId) {
  return transactionsRepository.sumSigned(tenantId, { fundId });
}

export async function getTotalBalance(tenantId) {
  return transactionsRepository.sumSigned(tenantId, {});
}

export async function getIncomeTotals(tenantId, { financialPeriodId, fundId } = {}) {
  return transactionsRepository.sumByType(tenantId, 'income', { financialPeriodId, fundId });
}

export async function getExpenseTotals(tenantId, { financialPeriodId, fundId } = {}) {
  return transactionsRepository.sumByType(tenantId, 'expense', { financialPeriodId, fundId });
}

export async function getTransactionHistory(tenantId, filters) {
  return transactionsRepository.listHistory(tenantId, filters);
}

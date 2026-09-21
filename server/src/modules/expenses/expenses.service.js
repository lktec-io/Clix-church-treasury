import { withTransaction } from '../../config/db.js';
import { nowSql } from '../../db/time.js';
import { AppError, notFound, forbidden } from '../../errors/AppError.js';
import { expensesRepository } from './expenses.repository.js';
import { generateExpenseNumber } from './expenseNumber.js';
import { postLedgerEntry } from '../financial/financialEngine.service.js';
import { getOpenPeriod } from '../financial/financialPeriods.service.js';
import { recordAuditLog } from '../audit/auditLog.service.js';
import { hardDelete, refuseDelete, blocker } from '../../db/deleteGuards.js';

const MAX_NUMBER_ATTEMPTS = 5;

function assertStatus(expense, expected) {
  if (expense.status !== expected) {
    throw new AppError('CONFLICT', `Expense must be in "${expected}" status (currently "${expense.status}")`, {
      status: 409,
    });
  }
}

// Raised when a conditional transition matched no row: between reading the
// expense and writing it, someone else moved it on. Same 409 as the check
// above, because to the caller it is the same situation — the expense is no
// longer in the state their click assumed.
function assertTransitioned(updated, expected) {
  if (!updated) {
    throw new AppError(
      'CONFLICT',
      `This expense is no longer in "${expected}" status — someone else acted on it first. Reload to see where it stands.`,
      { status: 409 }
    );
  }
  return updated;
}

// Draft only — no financial effect whatsoever. Nothing here touches the
// ledger; the expense doesn't even reserve a financial period yet
// (docs/FINANCIAL_ARCHITECTURE.md §8: money isn't spent, as far as the
// books are concerned, until someone with authority says it is).
export async function createExpense(tenantId, data, actorUserId) {
  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt += 1) {
    const expenseNumber = generateExpenseNumber();
    try {
      const expense = await expensesRepository.insert(tenantId, {
        expense_number: expenseNumber,
        category_id: data.categoryId,
        fund_id: data.fundId,
        account_id: data.accountId,
        amount: data.amount,
        payee: data.payee,
        description: data.description,
        payment_method: data.paymentMethod,
        reference: data.reference,
        attachment_mime: data.attachment?.mime ?? null,
        attachment_size_bytes: data.attachment?.sizeBytes ?? null,
        status: 'draft',
        requested_by_user_id: actorUserId,
      });
      await recordAuditLog({
        tenantId,
        actorUserId,
        action: 'expense.created',
        entityType: 'expenses',
        entityId: expense.id,
        after: { amount: data.amount, payee: data.payee },
      });
      return expense;
    } catch (error) {
      const isDuplicateNumber = error.code === 'ER_DUP_ENTRY' && error.message.includes('uq_expenses_tenant_number');
      if (!isDuplicateNumber || attempt === MAX_NUMBER_ATTEMPTS - 1) throw error;
    }
  }
  throw new AppError('INTERNAL_ERROR', 'Could not generate a unique expense number', { status: 500 });
}

export async function listExpenses(tenantId, filters) {
  return expensesRepository.search(tenantId, filters);
}

export async function getExpense(tenantId, id) {
  const expense = await expensesRepository.findById(tenantId, id);
  if (!expense) throw notFound('Expense not found');
  return expense;
}

// Only the fields a draft can still change — never touches amount/account/
// fund once submitted (enforced by requiring draft status here).
export async function updateExpense(tenantId, id, updates, actorUserId) {
  const expense = await expensesRepository.findById(tenantId, id);
  if (!expense) throw notFound('Expense not found');
  assertStatus(expense, 'draft');

  const updated = await expensesRepository.update(tenantId, id, updates);
  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'expense.updated',
    entityType: 'expenses',
    entityId: id,
    after: updates,
  });
  return updated;
}

export async function submitExpense(tenantId, id, actorUserId) {
  // One transaction around the state change AND its audit record: a
  // transition that happened but was not recorded is a hole in the audit
  // trail, and the trail is the only account of who moved this money.
  return withTransaction(async (connection) => {
    const expense = await expensesRepository.findById(tenantId, id, connection);
    if (!expense) throw notFound('Expense not found');
    assertStatus(expense, 'draft');

    // Conditional write: two submits of the same draft cannot both succeed.
    const updated = assertTransitioned(
      await expensesRepository.updateWhere(tenantId, id, { status: 'draft' }, { status: 'submitted' }, connection),
      'draft'
    );
    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'expense.submitted',
        entityType: 'expenses',
        entityId: id,
      },
      connection
    );
    return updated;
  });
}

// Segregation of duties: the requester cannot approve their own expense —
// docs/SECURITY_ARCHITECTURE.md §3, docs/MASTER_TODO.md Phase 5.
export async function approveExpense(tenantId, id, actorUserId) {
  return withTransaction(async (connection) => {
    const expense = await expensesRepository.findById(tenantId, id, connection);
    if (!expense) throw notFound('Expense not found');
    assertStatus(expense, 'submitted');
    if (expense.requested_by_user_id === actorUserId) {
      throw forbidden('You cannot approve an expense you requested yourself');
    }

    const updated = assertTransitioned(
      await expensesRepository.updateWhere(
        tenantId,
        id,
        { status: 'submitted' },
        { status: 'approved', approved_by_user_id: actorUserId, approval_date: nowSql() },
        connection
      ),
      'submitted'
    );
    // Inside the transaction: an approval with no audit row, or an audit row
    // for an approval that did not take, are both worse than neither.
    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'expense.approved',
        entityType: 'expenses',
        entityId: id,
      },
      connection
    );
    return updated;
  });
}

export async function rejectExpense(tenantId, id, reason, actorUserId) {
  return withTransaction(async (connection) => {
    const expense = await expensesRepository.findById(tenantId, id, connection);
    if (!expense) throw notFound('Expense not found');
    assertStatus(expense, 'submitted');

    const updated = assertTransitioned(
      await expensesRepository.updateWhere(
        tenantId,
        id,
        { status: 'submitted' },
        { status: 'rejected', rejected_by_user_id: actorUserId, rejection_reason: reason },
        connection
      ),
      'submitted'
    );
    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'expense.rejected',
        entityType: 'expenses',
        entityId: id,
        after: { reason },
      },
      connection
    );
    return updated;
  });
}

// Distinct from reject: sends a submitted expense back to draft so the
// requester can fix and resubmit it, rather than killing it outright
// (docs/MASTER_TODO.md Phase 5: "return for correction where appropriate").
// Gated by the same expense.reject permission — both are an approver-tier
// "not approving this as-is" decision, just with a different outcome.
export async function returnForCorrection(tenantId, id, reason, actorUserId) {
  return withTransaction(async (connection) => {
    const expense = await expensesRepository.findById(tenantId, id, connection);
    if (!expense) throw notFound('Expense not found');
    assertStatus(expense, 'submitted');

    const updated = assertTransitioned(
      await expensesRepository.updateWhere(tenantId, id, { status: 'submitted' }, { status: 'draft' }, connection),
      'submitted'
    );
    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'expense.returned_for_correction',
        entityType: 'expenses',
        entityId: id,
        after: { reason },
      },
      connection
    );
    return updated;
  });
}

// The only transition with a financial effect. Posts through the same
// engine every other module uses — never a parallel calculation
// (docs/FINANCIAL_ARCHITECTURE.md §8). Composed in one DB transaction with
// the status flip, so an expense can never end up "paid" with no matching
// ledger row, or vice versa.
export async function payExpense(tenantId, id, actorUserId) {
  return withTransaction(async (connection) => {
    // LOCKED READ. Paying posts a real ledger entry, so two concurrent
    // "Mark paid" clicks must not both get past the status check: that
    // would take the money out twice and leave the first transaction
    // orphaned (the expense can only point at one of them). The row lock
    // serialises them — the second request finds status 'paid' and is
    // refused with a 409.
    const expense = await expensesRepository.findByIdForUpdate(tenantId, id, connection);
    if (!expense) throw notFound('Expense not found');
    assertStatus(expense, 'approved');

    const openPeriod = await getOpenPeriod(tenantId, connection);
    if (!openPeriod) throw notFound('No open financial period to post this expense against');

    const transaction = await postLedgerEntry(connection, tenantId, {
      type: 'expense',
      direction: 'out',
      accountId: expense.account_id,
      fundId: expense.fund_id,
      categoryId: expense.category_id,
      financialPeriodId: openPeriod.id,
      amount: expense.amount,
      paymentMethod: expense.payment_method,
      referenceType: 'expenses',
      referenceId: expense.id,
      description: `Expense ${expense.expense_number} — ${expense.payee}`,
      createdByUserId: actorUserId,
    });

    const updated = await expensesRepository.update(
      tenantId,
      id,
      {
        status: 'paid',
        paid_by_user_id: actorUserId,
        payment_date: nowSql(),
        transaction_id: transaction.id,
      },
      connection
    );

    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'expense.paid',
        entityType: 'expenses',
        entityId: id,
        after: { transactionId: transaction.id },
      },
      connection
    );

    return { ...updated, transaction };
  });
}

/**
 * PERMANENT DELETE of an expense request.
 *
 * Refused once the expense has been PAID: paying is the moment money leaves
 * an account and a balanced ledger entry is written
 * (payExpense above), and the ledger is append-only. A paid expense that was
 * wrong is corrected by reversing the transaction, never by deleting the
 * record of it.
 *
 * Draft, submitted, approved and rejected requests have no financial effect
 * at all — no balance moved, no journal line exists — so a mistaken or
 * abandoned request can simply go.
 */
export async function hardDeleteExpense(tenantId, expenseId, actorUserId) {
  const expense = await expensesRepository.findById(tenantId, expenseId);
  if (!expense) throw notFound('Expense not found');

  if (expense.status === 'paid' || expense.transaction_id) {
    // The ledger posting IS the blocker here, and there is exactly one.
    refuseDelete(
      'This expense has been paid and posted to the ledger, so it cannot be deleted. Reverse the transaction instead — the ledger is append-only.',
      expense.transaction_id ? [blocker('transactions', 1)] : []
    );
  }

  return withTransaction(async (connection) => {
    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'expense.deleted',
        entityType: 'expenses',
        entityId: expenseId,
        before: {
          expenseNumber: expense.expense_number,
          payee: expense.payee,
          amount: expense.amount,
          status: expense.status,
        },
      },
      connection
    );

    await hardDelete(
      'This expense is still referenced by financial records, so it cannot be deleted.',
      () => expensesRepository.deleteById(tenantId, expenseId, connection)
    );

    return { id: expenseId, deleted: true };
  });
}

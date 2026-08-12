import { withTransaction } from '../../config/db.js';
import { nowSql } from '../../db/time.js';
import { AppError, notFound, forbidden } from '../../errors/AppError.js';
import { expensesRepository } from './expenses.repository.js';
import { generateExpenseNumber } from './expenseNumber.js';
import { postLedgerEntry } from '../financial/financialEngine.service.js';
import { getOpenPeriod } from '../financial/financialPeriods.service.js';
import { recordAuditLog } from '../audit/auditLog.service.js';

const MAX_NUMBER_ATTEMPTS = 5;

function assertStatus(expense, expected) {
  if (expense.status !== expected) {
    throw new AppError('CONFLICT', `Expense must be in "${expected}" status (currently "${expense.status}")`, {
      status: 409,
    });
  }
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
  const expense = await expensesRepository.findById(tenantId, id);
  if (!expense) throw notFound('Expense not found');
  assertStatus(expense, 'draft');

  const updated = await expensesRepository.update(tenantId, id, { status: 'submitted' });
  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'expense.submitted',
    entityType: 'expenses',
    entityId: id,
  });
  return updated;
}

// Segregation of duties: the requester cannot approve their own expense —
// docs/SECURITY_ARCHITECTURE.md §3, docs/MASTER_TODO.md Phase 5.
export async function approveExpense(tenantId, id, actorUserId) {
  const expense = await expensesRepository.findById(tenantId, id);
  if (!expense) throw notFound('Expense not found');
  assertStatus(expense, 'submitted');
  if (expense.requested_by_user_id === actorUserId) {
    throw forbidden('You cannot approve an expense you requested yourself');
  }

  const updated = await expensesRepository.update(tenantId, id, {
    status: 'approved',
    approved_by_user_id: actorUserId,
    approval_date: nowSql(),
  });
  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'expense.approved',
    entityType: 'expenses',
    entityId: id,
  });
  return updated;
}

export async function rejectExpense(tenantId, id, reason, actorUserId) {
  const expense = await expensesRepository.findById(tenantId, id);
  if (!expense) throw notFound('Expense not found');
  assertStatus(expense, 'submitted');

  const updated = await expensesRepository.update(tenantId, id, {
    status: 'rejected',
    rejected_by_user_id: actorUserId,
    rejection_reason: reason,
  });
  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'expense.rejected',
    entityType: 'expenses',
    entityId: id,
    after: { reason },
  });
  return updated;
}

// Distinct from reject: sends a submitted expense back to draft so the
// requester can fix and resubmit it, rather than killing it outright
// (docs/MASTER_TODO.md Phase 5: "return for correction where appropriate").
// Gated by the same expense.reject permission — both are an approver-tier
// "not approving this as-is" decision, just with a different outcome.
export async function returnForCorrection(tenantId, id, reason, actorUserId) {
  const expense = await expensesRepository.findById(tenantId, id);
  if (!expense) throw notFound('Expense not found');
  assertStatus(expense, 'submitted');

  const updated = await expensesRepository.update(tenantId, id, { status: 'draft' });
  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'expense.returned_for_correction',
    entityType: 'expenses',
    entityId: id,
    after: { reason },
  });
  return updated;
}

// The only transition with a financial effect. Posts through the same
// engine every other module uses — never a parallel calculation
// (docs/FINANCIAL_ARCHITECTURE.md §8). Composed in one DB transaction with
// the status flip, so an expense can never end up "paid" with no matching
// ledger row, or vice versa.
export async function payExpense(tenantId, id, actorUserId) {
  return withTransaction(async (connection) => {
    const expense = await expensesRepository.findById(tenantId, id, connection);
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

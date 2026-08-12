import { conflict, notFound } from '../../errors/AppError.js';
import { budgetsRepository } from './budgets.repository.js';
import { transactionsRepository } from '../financial/transactions.repository.js';
import { subtractMoney } from '../financial/money.js';
import { recordAuditLog } from '../audit/auditLog.service.js';

export async function createBudget(tenantId, data, actorUserId) {
  // Check-before-insert rather than relying solely on the DB unique
  // constraint — MySQL treats every NULL as distinct in a unique index, so
  // UNIQUE(tenant_id, period, fund, category) alone would not catch two
  // fund-level (category_id NULL) budgets for the same period+fund. Same
  // pattern already used for contributors.member_number and
  // categories.(type,name) in Phase 4.
  const existing = await budgetsRepository.findByPeriodFundCategory(
    tenantId,
    data.financialPeriodId,
    data.fundId,
    data.categoryId
  );
  if (existing) {
    throw conflict('A budget already exists for this period, fund, and category');
  }

  const budget = await budgetsRepository.insert(tenantId, {
    financial_period_id: data.financialPeriodId,
    fund_id: data.fundId,
    category_id: data.categoryId,
    type: data.type,
    budget_amount: data.budgetAmount,
    notes: data.notes,
    status: 'active',
    created_by_user_id: actorUserId,
  });

  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'budget.created',
    entityType: 'budgets',
    entityId: budget.id,
    after: { budgetAmount: data.budgetAmount, fundId: data.fundId, categoryId: data.categoryId },
  });

  return budget;
}

// Actual always comes from the Financial Engine's own aggregation
// (transactions.repository.js#sumByType) — never a second calculation
// (docs/FINANCIAL_ARCHITECTURE.md §6, docs/MASTER_TODO.md Phase 8: "do not
// create a separate calculation engine").
async function withActual(tenantId, budget) {
  const actual = await transactionsRepository.sumByType(tenantId, budget.type, {
    financialPeriodId: budget.financial_period_id,
    fundId: budget.fund_id,
    categoryId: budget.category_id ?? undefined,
  });
  const variance =
    budget.type === 'income'
      ? subtractMoney(actual, budget.budget_amount) // income: actual - planned (positive = ahead of plan)
      : subtractMoney(budget.budget_amount, actual); // expense: planned - actual (positive = under budget)
  return { ...budget, actual_amount: actual, variance };
}

export async function listBudgetsWithActual(tenantId, filters) {
  const budgets = await budgetsRepository.search(tenantId, filters);
  return Promise.all(budgets.map((b) => withActual(tenantId, b)));
}

export async function archiveBudget(tenantId, id, actorUserId) {
  const budget = await budgetsRepository.update(tenantId, id, { status: 'archived' });
  if (!budget) throw notFound('Budget not found');
  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'budget.archived',
    entityType: 'budgets',
    entityId: id,
  });
  return budget;
}

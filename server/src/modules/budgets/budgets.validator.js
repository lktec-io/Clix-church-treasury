import { validationError } from '../../errors/AppError.js';

const MONEY_NON_NEGATIVE_RE = /^\d{1,12}(\.\d{1,2})?$/;

function isNonNegativeMoneyString(value) {
  return typeof value === 'string' && MONEY_NON_NEGATIVE_RE.test(value);
}

export function validateCreateBudget(body) {
  const fields = {};

  if (!Number.isInteger(body.financialPeriodId)) fields.financialPeriodId = 'financialPeriodId is required';
  if (!Number.isInteger(body.fundId)) fields.fundId = 'fundId is required';
  if (body.categoryId !== undefined && body.categoryId !== null && !Number.isInteger(body.categoryId)) {
    fields.categoryId = 'must be an integer if provided';
  }
  if (!['income', 'expense'].includes(body.type)) {
    fields.type = 'must be "income" or "expense"';
  }
  if (!isNonNegativeMoneyString(body.budgetAmount)) {
    fields.budgetAmount = 'must be a non-negative decimal string with at most 2 places, e.g. "5000000.00"';
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    fields.notes = 'must be a string';
  }

  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid budget payload', fields);
  }

  return {
    financialPeriodId: body.financialPeriodId,
    fundId: body.fundId,
    categoryId: body.categoryId ?? null,
    type: body.type,
    budgetAmount: body.budgetAmount,
    notes: body.notes?.trim() || null,
  };
}

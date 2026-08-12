import { validationError } from '../../errors/AppError.js';
import { isValidPaymentMethod, PAYMENT_METHODS } from '../financial/paymentMethods.js';
import { isPositiveMoneyString } from '../financial/money.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateCreateContribution(body) {
  const fields = {};

  if (!isPositiveMoneyString(body.amount)) {
    fields.amount = 'must be a positive decimal string with at most 2 places, e.g. "100.50"';
  }
  if (!Number.isInteger(body.accountId)) fields.accountId = 'accountId is required';
  if (!Number.isInteger(body.fundId)) fields.fundId = 'fundId is required';
  if (!Number.isInteger(body.categoryId)) fields.categoryId = 'categoryId is required';
  if (body.contributorId !== undefined && body.contributorId !== null && !Number.isInteger(body.contributorId)) {
    fields.contributorId = 'must be an integer if provided';
  }
  if (body.pledgeId !== undefined && body.pledgeId !== null && !Number.isInteger(body.pledgeId)) {
    fields.pledgeId = 'must be an integer if provided';
  }
  if (!isValidPaymentMethod(body.paymentMethod)) {
    fields.paymentMethod = `must be one of: ${PAYMENT_METHODS.join(', ')}`;
  }
  if (typeof body.contributionDate !== 'string' || !DATE_RE.test(body.contributionDate)) {
    fields.contributionDate = 'must be a date string in YYYY-MM-DD format';
  }
  if (body.reference !== undefined && body.reference !== null && typeof body.reference !== 'string') {
    fields.reference = 'must be a string';
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    fields.notes = 'must be a string';
  }

  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid contribution payload', fields);
  }

  return {
    amount: body.amount,
    accountId: body.accountId,
    fundId: body.fundId,
    categoryId: body.categoryId,
    contributorId: body.contributorId ?? null,
    pledgeId: body.pledgeId ?? null,
    paymentMethod: body.paymentMethod,
    contributionDate: body.contributionDate,
    reference: body.reference?.trim() || null,
    notes: body.notes?.trim() || null,
  };
}

export function validateUpdateContribution(body) {
  // Deliberately narrow: only non-financial metadata is editable on a
  // posted contribution — amount/account/fund/category are immutable once
  // posted (docs/FINANCIAL_ARCHITECTURE.md §4). Corrections to those go
  // through reversal, not this endpoint.
  const fields = {};
  if (body.reference !== undefined && body.reference !== null && typeof body.reference !== 'string') {
    fields.reference = 'must be a string';
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    fields.notes = 'must be a string';
  }
  if (body.contributorId !== undefined && body.contributorId !== null && !Number.isInteger(body.contributorId)) {
    fields.contributorId = 'must be an integer if provided';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid contribution update payload', fields);
  }
  const updates = {};
  if (body.reference !== undefined) updates.reference = body.reference?.trim() || null;
  if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
  if (body.contributorId !== undefined) updates.contributor_id = body.contributorId;
  return updates;
}

export function validateReverseContribution(body) {
  if (typeof body?.reason !== 'string' || body.reason.trim().length === 0) {
    throw validationError('Invalid payload', { reason: 'a reason is required to reverse a contribution' });
  }
  return { reason: body.reason.trim() };
}

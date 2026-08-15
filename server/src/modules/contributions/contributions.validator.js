import { validationError } from '../../errors/AppError.js';
import { isValidPaymentMethod, PAYMENT_METHODS } from '../financial/paymentMethods.js';
import { isPositiveMoneyString, sumMoney, compareMoney } from '../financial/money.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 20;

// Optional receipt/statement-level breakdown (e.g. "Sadaka ya Kambi = 5,000"
// + "Ujenzi wa Kambi = 5,000" under one 10,000 payment) — see
// contribution_items migration (0028) for why this doesn't carry its own
// category_id. Returns null when no items were supplied, so a contribution
// with no breakdown behaves exactly as it did before this validator gained
// this branch.
function validateItems(rawItems, totalAmount, fields) {
  if (rawItems === undefined || rawItems === null) return null;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    fields.items = 'must be a non-empty array if provided';
    return null;
  }
  if (rawItems.length > MAX_ITEMS) {
    fields.items = `must contain at most ${MAX_ITEMS} items`;
    return null;
  }
  const items = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const item = rawItems[i] ?? {};
    if (typeof item.purpose !== 'string' || item.purpose.trim().length === 0 || item.purpose.length > 150) {
      fields.items = `item ${i}: purpose is required and must be at most 150 characters`;
      return null;
    }
    if (!isPositiveMoneyString(item.amount)) {
      fields.items = `item ${i}: amount must be a positive decimal string with at most 2 places`;
      return null;
    }
    items.push({ purpose: item.purpose.trim(), amount: item.amount });
  }
  if (isPositiveMoneyString(totalAmount) && compareMoney(sumMoney(items.map((i) => i.amount)), totalAmount) !== 0) {
    fields.items = `item amounts must sum to the total amount (${totalAmount})`;
    return null;
  }
  return items;
}

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
  if (body.reference !== undefined && body.reference !== null) {
    if (typeof body.reference !== 'string') fields.reference = 'must be a string';
    else if (body.reference.length > 100) fields.reference = 'must be at most 100 characters';
  }
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== 'string') fields.notes = 'must be a string';
    else if (body.notes.length > 500) fields.notes = 'must be at most 500 characters';
  }
  if (body.idempotencyKey !== undefined && body.idempotencyKey !== null) {
    if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length > 100) {
      fields.idempotencyKey = 'must be a string of at most 100 characters if provided';
    }
  }

  const items = validateItems(body.items, body.amount, fields);

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
    idempotencyKey: body.idempotencyKey?.trim() || null,
    items,
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

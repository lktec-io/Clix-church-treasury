import { validationError } from '../../errors/AppError.js';
import { isPositiveMoneyString } from '../financial/money.js';

export function validateCreateTransfer(body) {
  const fields = {};

  if (!Number.isInteger(body.fromAccountId)) fields.fromAccountId = 'fromAccountId is required';
  if (!Number.isInteger(body.toAccountId)) fields.toAccountId = 'toAccountId is required';
  if (!Number.isInteger(body.fromFundId)) fields.fromFundId = 'fromFundId is required';
  if (!Number.isInteger(body.toFundId)) fields.toFundId = 'toFundId is required';
  if (!isPositiveMoneyString(body.amount)) {
    fields.amount = 'must be a positive decimal string with at most 2 places, e.g. "100.50"';
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    fields.description = 'must be a string';
  }
  // A same-account-and-fund no-op is also rejected by the engine itself
  // (financialEngine.service.js#transfer), but catching it here gives a
  // clearer field-level validation error before any DB work happens.
  if (
    Number.isInteger(body.fromAccountId) &&
    Number.isInteger(body.toAccountId) &&
    Number.isInteger(body.fromFundId) &&
    Number.isInteger(body.toFundId) &&
    body.fromAccountId === body.toAccountId &&
    body.fromFundId === body.toFundId
  ) {
    fields.toAccountId = 'a transfer must move money to a different account or a different fund';
  }

  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid transfer payload', fields);
  }

  return {
    fromAccountId: body.fromAccountId,
    toAccountId: body.toAccountId,
    fromFundId: body.fromFundId,
    toFundId: body.toFundId,
    amount: body.amount,
    description: body.description?.trim() || null,
  };
}

import { validationError } from '../../errors/AppError.js';
import { isPositiveMoneyString } from '../financial/money.js';

// Percentages arrive as strings for the same reason money does: they are
// stored in a DECIMAL column and multiplied against real amounts, so they
// must never round-trip through a JS float on the way in.
const PERCENT_RE = /^\d{1,3}(\.\d{1,2})?$/;

export function validateCreateRule(body) {
  const fields = {};

  const fundId = Number(body.fundId);
  if (!Number.isInteger(fundId) || fundId <= 0) fields.fundId = 'must be a fund id';

  if (typeof body.higherBodyName !== 'string' || body.higherBodyName.trim().length === 0) {
    fields.higherBodyName = 'the receiving body is required';
  } else if (body.higherBodyName.length > 150) {
    fields.higherBodyName = 'must be at most 150 characters';
  }

  const percentage = String(body.percentageToRemit ?? '');
  if (!PERCENT_RE.test(percentage)) {
    fields.percentageToRemit = 'must be a percentage with at most 2 decimal places';
  } else if (Number(percentage) > 100) {
    // A church cannot owe more than it received.
    fields.percentageToRemit = 'must be between 0 and 100';
  }

  if (Object.keys(fields).length > 0) throw validationError('Invalid remittance rule', fields);

  return {
    fundId,
    higherBodyName: body.higherBodyName.trim(),
    percentageToRemit: percentage,
  };
}

export function validateRemitPayment(body) {
  const fields = {};

  const accountId = Number(body.accountId);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    fields.accountId = 'must reference the account the money is paid from';
  }
  if (!isPositiveMoneyString(String(body.amount ?? ''))) {
    fields.amount = 'must be a positive decimal string with at most 2 places';
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    fields.description = 'must be a string';
  }

  if (Object.keys(fields).length > 0) throw validationError('Invalid remittance payment', fields);

  return {
    accountId,
    amount: String(body.amount),
    description: body.description?.trim() || null,
  };
}

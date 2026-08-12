import { validationError } from '../../errors/AppError.js';
import { isPositiveMoneyString } from '../financial/money.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateCreatePledge(body) {
  const fields = {};

  if (!Number.isInteger(body.contributorId)) fields.contributorId = 'contributorId is required';
  if (!Number.isInteger(body.fundId)) fields.fundId = 'fundId is required';
  if (!isPositiveMoneyString(body.pledgedAmount)) {
    fields.pledgedAmount = 'must be a positive decimal string with at most 2 places, e.g. "1000000.00"';
  }
  if (typeof body.pledgeDate !== 'string' || !DATE_RE.test(body.pledgeDate)) {
    fields.pledgeDate = 'must be a date string in YYYY-MM-DD format';
  }
  if (body.targetDate !== undefined && body.targetDate !== null && !DATE_RE.test(body.targetDate)) {
    fields.targetDate = 'must be a date string in YYYY-MM-DD format if provided';
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    fields.notes = 'must be a string';
  }

  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid pledge payload', fields);
  }

  return {
    contributorId: body.contributorId,
    fundId: body.fundId,
    pledgedAmount: body.pledgedAmount,
    pledgeDate: body.pledgeDate,
    targetDate: body.targetDate ?? null,
    notes: body.notes?.trim() || null,
  };
}

export function validateUpdatePledge(body) {
  const fields = {};
  if (body.targetDate !== undefined && body.targetDate !== null && !DATE_RE.test(body.targetDate)) {
    fields.targetDate = 'must be a date string in YYYY-MM-DD format if provided';
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    fields.notes = 'must be a string';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid pledge update payload', fields);
  }
  const updates = {};
  if (body.targetDate !== undefined) updates.target_date = body.targetDate;
  if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
  return updates;
}

const VALID_STATUS_TRANSITIONS = ['completed', 'cancelled', 'active'];

export function validateSetPledgeStatus(body) {
  if (!VALID_STATUS_TRANSITIONS.includes(body.status)) {
    throw validationError('Invalid payload', {
      status: `must be one of: ${VALID_STATUS_TRANSITIONS.join(', ')}`,
    });
  }
  return body.status;
}

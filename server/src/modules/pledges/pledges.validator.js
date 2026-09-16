import { validationError } from '../../errors/AppError.js';
import { isPositiveMoneyString } from '../financial/money.js';
import { PLEDGE_FREQUENCIES } from './pledgeSchedule.js';

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
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== 'string') fields.notes = 'must be a string';
    else if (body.notes.length > 500) fields.notes = 'must be at most 500 characters';
  }

  // Payment frequency (migration 0038). A recurring pledge needs an end date:
  // without one the number of installments — and so the amount of each — is
  // undefined, and the schedule would have nothing to show.
  const frequency = body.frequency === undefined || body.frequency === null || body.frequency === '' ? 'once' : body.frequency;
  if (!PLEDGE_FREQUENCIES.includes(frequency)) {
    fields.frequency = `must be one of: ${PLEDGE_FREQUENCIES.join(', ')}`;
  } else if (frequency !== 'once' && !body.targetDate) {
    fields.targetDate = 'a target date is required for a daily, weekly or monthly pledge';
  }
  if (
    typeof body.targetDate === 'string' &&
    typeof body.pledgeDate === 'string' &&
    DATE_RE.test(body.targetDate) &&
    DATE_RE.test(body.pledgeDate) &&
    body.targetDate < body.pledgeDate
  ) {
    fields.targetDate = 'must be on or after the pledge date';
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
    frequency,
  };
}

export function validateUpdatePledge(body) {
  const fields = {};
  if (body.targetDate !== undefined && body.targetDate !== null && !DATE_RE.test(body.targetDate)) {
    fields.targetDate = 'must be a date string in YYYY-MM-DD format if provided';
  }
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== 'string') fields.notes = 'must be a string';
    else if (body.notes.length > 500) fields.notes = 'must be at most 500 characters';
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

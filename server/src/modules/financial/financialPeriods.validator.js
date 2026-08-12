import { validationError } from '../../errors/AppError.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateCreatePeriod(body) {
  const fields = {};
  if (typeof body.label !== 'string' || body.label.trim().length === 0) {
    fields.label = 'label is required';
  }
  if (typeof body.startDate !== 'string' || !DATE_RE.test(body.startDate)) {
    fields.startDate = 'must be a date string in YYYY-MM-DD format';
  }
  if (typeof body.endDate !== 'string' || !DATE_RE.test(body.endDate)) {
    fields.endDate = 'must be a date string in YYYY-MM-DD format';
  }
  if (
    typeof body.startDate === 'string' &&
    typeof body.endDate === 'string' &&
    DATE_RE.test(body.startDate) &&
    DATE_RE.test(body.endDate) &&
    body.endDate < body.startDate
  ) {
    fields.endDate = 'must not be before startDate';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid financial period payload', fields);
  }
  return { label: body.label.trim(), startDate: body.startDate, endDate: body.endDate };
}

export function validateReopenPeriod(body) {
  if (typeof body?.reason !== 'string' || body.reason.trim().length === 0) {
    throw validationError('Invalid payload', { reason: 'a reason is required to reopen a closed period' });
  }
  return body.reason.trim();
}

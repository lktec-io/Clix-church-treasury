import { validationError } from '../../errors/AppError.js';

export function validateCreateFund(body) {
  const fields = {};
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    fields.name = 'name is required';
  }
  if (body.isRestricted !== undefined && typeof body.isRestricted !== 'boolean') {
    fields.isRestricted = 'isRestricted must be a boolean';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid fund payload', fields);
  }
  return { name: body.name.trim(), isRestricted: body.isRestricted ?? false };
}

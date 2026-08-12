import { validationError } from '../../errors/AppError.js';

const VALID_TYPES = ['income', 'expense'];

export function validateCreateCategory(body) {
  const fields = {};
  if (!VALID_TYPES.includes(body.type)) {
    fields.type = `type must be one of: ${VALID_TYPES.join(', ')}`;
  }
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    fields.name = 'name is required';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid category payload', fields);
  }
  return { type: body.type, name: body.name.trim() };
}

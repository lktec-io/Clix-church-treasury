import { validationError } from '../../errors/AppError.js';

const VALID_TYPES = ['bank', 'cash', 'mobile_money'];

export function validateCreateAccount(body) {
  const fields = {};
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    fields.name = 'name is required';
  }
  if (!VALID_TYPES.includes(body.type)) {
    fields.type = `type must be one of: ${VALID_TYPES.join(', ')}`;
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid account payload', fields);
  }
  return { name: body.name.trim(), type: body.type };
}

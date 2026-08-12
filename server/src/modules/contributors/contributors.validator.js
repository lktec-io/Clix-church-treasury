import { validationError } from '../../errors/AppError.js';

export function validateCreateContributor(body) {
  const fields = {};
  if (typeof body.fullName !== 'string' || body.fullName.trim().length === 0) {
    fields.fullName = 'fullName is required';
  }
  if (body.email !== undefined && body.email !== null && typeof body.email !== 'string') {
    fields.email = 'must be a string';
  }
  if (body.phone !== undefined && body.phone !== null && typeof body.phone !== 'string') {
    fields.phone = 'must be a string';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid contributor payload', fields);
  }
  return {
    fullName: body.fullName.trim(),
    phone: body.phone?.trim() || null,
    email: body.email?.trim() || null,
    memberNumber: body.memberNumber?.trim() || null,
  };
}

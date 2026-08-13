import { validationError } from '../../errors/AppError.js';

export function validateCreateContributor(body) {
  const fields = {};
  if (typeof body.fullName !== 'string' || body.fullName.trim().length === 0) {
    fields.fullName = 'fullName is required';
  } else if (body.fullName.length > 255) {
    fields.fullName = 'must be at most 255 characters';
  }
  if (body.email !== undefined && body.email !== null) {
    if (typeof body.email !== 'string') fields.email = 'must be a string';
    else if (body.email.length > 255) fields.email = 'must be at most 255 characters';
  }
  if (body.phone !== undefined && body.phone !== null) {
    if (typeof body.phone !== 'string') fields.phone = 'must be a string';
    else if (body.phone.length > 50) fields.phone = 'must be at most 50 characters';
  }
  if (body.memberNumber !== undefined && body.memberNumber !== null) {
    if (typeof body.memberNumber !== 'string') fields.memberNumber = 'must be a string';
    else if (body.memberNumber.length > 50) fields.memberNumber = 'must be at most 50 characters';
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

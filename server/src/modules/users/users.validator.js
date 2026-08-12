import { validationError } from '../../errors/AppError.js';
import { validateEmail } from '../auth/auth.validator.js';

export function validateInviteUser(body) {
  const fields = {};
  try {
    validateEmail(body.email);
  } catch {
    fields.email = 'must be a valid email address';
  }
  if (typeof body.fullName !== 'string' || body.fullName.trim().length === 0) {
    fields.fullName = 'fullName is required';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid invite payload', fields);
  }
  return { email: body.email.trim().toLowerCase(), fullName: body.fullName.trim() };
}

export function validateAssignRole(body) {
  if (!Number.isInteger(body.roleId)) {
    throw validationError('Invalid payload', { roleId: 'roleId is required and must be an integer' });
  }
  return { roleId: body.roleId };
}

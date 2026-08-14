import { validationError } from '../../errors/AppError.js';

const PIN_RE = /^\d{4}$/;

export function validateMemberLogin(body) {
  const fields = {};
  if (typeof body.tenantSlug !== 'string' || body.tenantSlug.trim().length === 0) {
    fields.tenantSlug = 'tenantSlug is required';
  }
  if (typeof body.memberNumber !== 'string' || body.memberNumber.trim().length === 0) {
    fields.memberNumber = 'memberNumber is required';
  }
  if (typeof body.pin !== 'string' || !PIN_RE.test(body.pin)) {
    fields.pin = 'must be a 4-digit PIN';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid login payload', fields);
  }
  return {
    tenantSlug: body.tenantSlug.trim().toLowerCase(),
    memberNumber: body.memberNumber.trim(),
    pin: body.pin,
  };
}

export function validateChangePin(body) {
  const fields = {};
  if (typeof body.currentPin !== 'string' || !PIN_RE.test(body.currentPin)) {
    fields.currentPin = 'must be a 4-digit PIN';
  }
  if (typeof body.newPin !== 'string' || !PIN_RE.test(body.newPin)) {
    fields.newPin = 'must be a 4-digit PIN';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid payload', fields);
  }
  return { currentPin: body.currentPin, newPin: body.newPin };
}

import { validationError } from '../../errors/AppError.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Length over forced complexity mixing — current OWASP/NIST guidance favors
// long passwords over "must contain a symbol" rules that push users toward
// predictable substitutions.
const MIN_PASSWORD_LENGTH = 10;

export function validatePassword(password, fieldName = 'password') {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw validationError('Invalid password', {
      [fieldName]: `must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
  }
}

export function validateEmail(email, fieldName = 'email') {
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    throw validationError('Invalid email', { [fieldName]: 'must be a valid email address' });
  }
}

export function validateLogin(body) {
  const fields = {};
  if (typeof body.tenantSlug !== 'string' || body.tenantSlug.trim().length === 0) {
    fields.tenantSlug = 'tenantSlug is required';
  }
  if (typeof body.email !== 'string' || body.email.trim().length === 0) {
    fields.email = 'email is required';
  }
  if (typeof body.password !== 'string' || body.password.length === 0) {
    fields.password = 'password is required';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid login payload', fields);
  }
  return {
    tenantSlug: body.tenantSlug.trim().toLowerCase(),
    email: body.email.trim().toLowerCase(),
    password: body.password,
  };
}

export function validateRegisterTenant(body) {
  const fields = {};
  if (typeof body.churchName !== 'string' || body.churchName.trim().length === 0) {
    fields.churchName = 'churchName is required';
  }
  if (typeof body.adminFullName !== 'string' || body.adminFullName.trim().length === 0) {
    fields.adminFullName = 'adminFullName is required';
  }
  try {
    validateEmail(body.adminEmail, 'adminEmail');
  } catch {
    fields.adminEmail = 'must be a valid email address';
  }
  try {
    validatePassword(body.adminPassword, 'adminPassword');
  } catch {
    fields.adminPassword = 'must be at least 10 characters';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid registration payload', fields);
  }
  return {
    churchName: body.churchName.trim(),
    adminEmail: body.adminEmail.trim().toLowerCase(),
    adminPassword: body.adminPassword,
    adminFullName: body.adminFullName.trim(),
  };
}

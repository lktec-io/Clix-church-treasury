import { validationError } from '../../errors/AppError.js';
import { validateEmail, validatePassword } from '../auth/auth.validator.js';

// Deliberately reuses auth.validator.js's exact email/password rules
// (same 254-char/RFC-shape email check, same 10-char minimum password) —
// a platform-created tenant admin logs in through the exact same /login
// flow as a self-registered one, so its credentials must satisfy the
// exact same contract, not a parallel one that could drift.
export function validateCreateTenant(body) {
  const fields = {};
  if (typeof body.churchName !== 'string' || body.churchName.trim().length === 0) {
    fields.churchName = 'churchName is required';
  } else if (body.churchName.length > 255) {
    fields.churchName = 'must be at most 255 characters';
  }
  if (typeof body.adminFullName !== 'string' || body.adminFullName.trim().length === 0) {
    fields.adminFullName = 'adminFullName is required';
  } else if (body.adminFullName.length > 255) {
    fields.adminFullName = 'must be at most 255 characters';
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
    throw validationError('Invalid tenant creation payload', fields);
  }
  return {
    churchName: body.churchName.trim(),
    adminFullName: body.adminFullName.trim(),
    adminEmail: body.adminEmail.trim().toLowerCase(),
    adminPassword: body.adminPassword,
  };
}

const CURRENCY_RE = /^[A-Z]{3}$/;
const LOCALE_RE = /^[a-z]{2}$/;

export function validateUpdateTenant(body) {
  const fields = {};
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    fields.name = 'name is required';
  } else if (body.name.length > 255) {
    fields.name = 'must be at most 255 characters';
  }
  const baseCurrency = body.baseCurrency ?? 'TZS';
  if (!CURRENCY_RE.test(baseCurrency)) {
    fields.baseCurrency = 'must be a 3-letter currency code (e.g. TZS)';
  }
  const localeDefault = body.localeDefault ?? 'sw';
  if (!LOCALE_RE.test(localeDefault)) {
    fields.localeDefault = 'must be a 2-letter locale code (e.g. en, sw)';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid tenant update payload', fields);
  }
  return { name: body.name.trim(), baseCurrency, localeDefault };
}

const VALID_STATUSES = ['active', 'suspended'];

export function validateTenantStatus(body) {
  if (!VALID_STATUSES.includes(body.status)) {
    throw validationError('Invalid status', { status: `must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  return { status: body.status };
}

export function validateUpdateTenantAdmin(body) {
  const fields = {};
  if (typeof body.userId !== 'number' && typeof body.userId !== 'string') {
    fields.userId = 'userId is required';
  }
  if (typeof body.fullName !== 'string' || body.fullName.trim().length === 0) {
    fields.fullName = 'fullName is required';
  } else if (body.fullName.length > 255) {
    fields.fullName = 'must be at most 255 characters';
  }
  try {
    validateEmail(body.email, 'email');
  } catch {
    fields.email = 'must be a valid email address';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid tenant admin update payload', fields);
  }
  return { userId: Number(body.userId), fullName: body.fullName.trim(), email: body.email.trim().toLowerCase() };
}

// Only shape-checks that a confirmation string was supplied. Whether it
// actually MATCHES the tenant is decided in platform.service.js#deleteTenant,
// which is the only layer that has the tenant row to compare against.
export function validateDeleteTenant(body) {
  if (typeof body.confirmationSlug !== 'string' || body.confirmationSlug.trim().length === 0) {
    throw validationError('Deletion requires confirmation', {
      confirmationSlug: 'type the tenant slug to confirm deletion',
    });
  }
  return { confirmationSlug: body.confirmationSlug.trim() };
}

export function validateResetTenantAdminPassword(body) {
  const fields = {};
  if (typeof body.userId !== 'number' && typeof body.userId !== 'string') {
    fields.userId = 'userId is required';
  }
  try {
    validatePassword(body.newPassword, 'newPassword');
  } catch {
    fields.newPassword = 'must be at least 10 characters';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid password reset payload', fields);
  }
  return { userId: Number(body.userId), newPassword: body.newPassword };
}

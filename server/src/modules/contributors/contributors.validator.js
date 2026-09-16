import { validationError } from '../../errors/AppError.js';
import { validateMemberIdentity } from './memberId.js';

const GENDERS = ['male', 'female', 'unspecified'];

// The bulk-import body: a base64 file plus its original name (kept only for
// the audit-friendly error messages and the response, never used to decide
// how to parse — bulkImport.js sniffs the actual bytes for that).
export function validateBulkImport(body) {
  const fields = {};
  if (typeof body.contentBase64 !== 'string' || body.contentBase64.trim().length === 0) {
    fields.contentBase64 = 'a file is required';
  }
  if (body.fileName !== undefined && body.fileName !== null && typeof body.fileName !== 'string') {
    fields.fileName = 'must be a string';
  }
  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid import payload', fields);
  }
  return { contentBase64: body.contentBase64, fileName: body.fileName?.slice(0, 255) ?? null };
}

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
  // Optional, and only ever one of the three ENUM values (migration 0035).
  // An empty string is treated as "not provided" rather than rejected, since
  // that is what an untouched form field sends.
  if (body.gender !== undefined && body.gender !== null && body.gender !== '') {
    if (typeof body.gender !== 'string' || !GENDERS.includes(body.gender)) {
      fields.gender = `must be one of: ${GENDERS.join(', ')}`;
    }
  }
  // Identity document (NIDA / voter ID / driving licence / none). Enforced
  // here as well as in the browser: the client-side check is instant
  // feedback, this is the rule — a request that skips the form skips the
  // client check too.
  const identity = validateMemberIdentity({ idType: body.idType, idNumber: body.idNumber, idNote: body.idNote });
  Object.assign(fields, identity.fields);

  if (Object.keys(fields).length > 0) {
    throw validationError('Invalid contributor payload', fields);
  }
  return {
    fullName: body.fullName.trim(),
    phone: body.phone?.trim() || null,
    email: body.email?.trim() || null,
    gender: body.gender || null,
    memberNumber: body.memberNumber?.trim() || null,
    ...identity.value,
  };
}

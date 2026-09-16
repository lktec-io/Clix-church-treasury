// Form-state helpers for MemberIdentityFields. Kept apart from both the
// component (a component file may only export components, for fast refresh)
// and utils/memberId.js (which must stay byte-identical to the server copy).
import { NIDA_LENGTH, validateMemberIdentity, validateNida } from './memberId.js';

export function emptyIdentity() {
  return { idType: '', idNumber: '', idNote: '' };
}

/**
 * Error message for the identity block, or null when it may be submitted.
 * Uses the same validator the server runs, so a form that passes here is not
 * rejected there for identity reasons.
 */
export function identityError(identity, t) {
  if (identity.idType === 'nida') {
    const result = validateNida(identity.idNumber);
    return result.valid ? null : t(`memberId.nida.error.${result.reason}`, { length: NIDA_LENGTH });
  }
  const { fields } = validateMemberIdentity(identity);
  if (fields.idNumber) return t('memberId.document.error');
  if (fields.idNote) return t('memberId.note.error');
  return null;
}

/** The body the API expects — empty values omitted rather than sent as ''. */
export function identityPayload(identity) {
  if (!identity.idType) return {};
  if (identity.idType === 'none') return { idType: 'none', idNote: identity.idNote.trim() || undefined };
  return { idType: identity.idType, idNumber: identity.idNumber };
}

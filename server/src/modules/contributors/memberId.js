// Member identity-document validation. Pure: no I/O, no env, so it is unit
// testable on its own and callable from any validator.
//
// The web app no longer collects identity documents, so this runs only when
// an API caller supplies the optional id fields (the contributors columns
// from migration 0038 are kept). tests/phase19/treasuryFeatures.test.js
// covers the rules.
//
// ── WHAT THIS CAN AND CANNOT PROVE ─────────────────────────────────────────
// It rejects numbers that are STRUCTURALLY impossible: wrong length,
// non-digits, a birth date that does not exist, a future birth date, and
// obviously fabricated repeated or counting patterns.
//
// It CANNOT prove a well-formed number belongs to a real person. Anyone can
// type 20 digits that start with a valid date. Genuine verification needs
// NIDA's own lookup service; a pattern check is a typo and laziness filter,
// not identity proof.
//
// Two things deliberately NOT implemented, because doing them from guesswork
// would reject real members:
//   · Registration-zone validation. There is no public, authoritative table
//     mapping NIN digits to Tanzanian registration zones that could be
//     embedded here. A made-up list would silently block legitimate members
//     whose zone happened not to be on it.
//   · A checksum on the final digits. No public check-digit algorithm for
//     the NIN has been published to verify against, so any "cryptographic"
//     check would be invented and would reject valid numbers.

export const ID_TYPES = ['nida', 'voter_id', 'driving_licence', 'none'];

export const NIDA_LENGTH = 20;
const EARLIEST_BIRTH_YEAR = 1900;

/** Strips the separators people type (spaces, dashes) and keeps digits. */
export function normalizeNida(raw) {
  return String(raw ?? '').replace(/[\s-]/g, '');
}

// True when every digit steps by exactly +1 (or exactly -1) from the last,
// wrapping 9→0 — "12345678901234567890" or "98765432109876543210".
function isSequential(digits) {
  if (digits.length < 2) return false;
  const step = (Number(digits[1]) - Number(digits[0]) + 10) % 10;
  if (step !== 1 && step !== 9) return false;
  for (let i = 1; i < digits.length; i += 1) {
    if ((Number(digits[i]) - Number(digits[i - 1]) + 10) % 10 !== step) return false;
  }
  return true;
}

const isRepeated = (digits) => /^(\d)\1*$/.test(digits);

/**
 * Validates a Tanzanian National ID (NIDA NIN).
 * Returns { valid: true, normalized } or { valid: false, reason } where
 * `reason` is a stable machine code the UI translates.
 *
 * `today` is injectable so tests do not depend on the calendar.
 */
export function validateNida(raw, today = new Date()) {
  const digits = normalizeNida(raw);

  if (digits.length === 0) return { valid: false, reason: 'required' };
  if (!/^\d+$/.test(digits)) return { valid: false, reason: 'digits_only' };
  if (digits.length !== NIDA_LENGTH) return { valid: false, reason: 'length' };

  // Whole-number fabrications.
  if (isRepeated(digits) || isSequential(digits)) return { valid: false, reason: 'pattern' };

  // The 12 digits after the birth date are where a fabricated number usually
  // gives itself away: a real date followed by 000000000000 or 123456789012.
  // Checked separately because a genuine date legitimately contains repeats
  // ("19900101"), so the whole-number test alone would miss these.
  const tail = digits.slice(8);
  if (isRepeated(tail) || isSequential(tail)) return { valid: false, reason: 'pattern' };

  // First eight digits: the holder's birth date as YYYYMMDD.
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const currentYear = today.getUTCFullYear();
  if (year < EARLIEST_BIRTH_YEAR || year > currentYear) return { valid: false, reason: 'birth_year' };

  // A real calendar date — rejects 30 February and month 13. Built in UTC so
  // a server in any timezone agrees with the browser about what "the date"
  // is.
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  ) {
    return { valid: false, reason: 'birth_date' };
  }

  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (birth.getTime() > todayUtc) return { valid: false, reason: 'birth_future' };

  return { valid: true, normalized: digits };
}

// Voter ID and driving licence numbers vary in format across issuing years,
// so these are sanity bounds only — enough to catch an empty or pasted-garbage
// value without rejecting a legitimate older card format.
const DOC_NUMBER_RE = /^[A-Za-z0-9-]{4,30}$/;

/**
 * Validates the identity fields of a member as a unit.
 * Returns { fields, value } — `fields` is an error map (empty when valid),
 * `value` is what should be stored.
 */
export function validateMemberIdentity({ idType, idNumber, idNote } = {}, today = new Date()) {
  const fields = {};

  // Identity is optional as a whole: an existing member record with no
  // document information is not invalid.
  if (idType === undefined || idType === null || idType === '') {
    return { fields, value: { idType: null, idNumber: null, idNote: null } };
  }
  if (!ID_TYPES.includes(idType)) {
    fields.idType = `must be one of: ${ID_TYPES.join(', ')}`;
    return { fields, value: null };
  }

  if (idType === 'none') {
    const note = typeof idNote === 'string' ? idNote.trim() : '';
    if (note.length > 255) fields.idNote = 'must be at most 255 characters';
    return { fields, value: { idType, idNumber: null, idNote: note || null } };
  }

  if (idType === 'nida') {
    const result = validateNida(idNumber, today);
    if (!result.valid) {
      fields.idNumber = `invalid NIDA number (${result.reason})`;
      return { fields, value: null };
    }
    return { fields, value: { idType, idNumber: result.normalized, idNote: null } };
  }

  const number = typeof idNumber === 'string' ? idNumber.trim() : '';
  if (!DOC_NUMBER_RE.test(number)) {
    fields.idNumber = 'must be 4–30 letters, digits or dashes';
    return { fields, value: null };
  }
  return { fields, value: { idType, idNumber: number.toUpperCase(), idNote: null } };
}

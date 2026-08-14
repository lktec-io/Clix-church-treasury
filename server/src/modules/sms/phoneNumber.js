// Normalizes a Tanzanian mobile number to the bare-digits, country-code-
// prefixed form Beem Africa's API expects ("2557XXXXXXXX" /
// "2556XXXXXXXX") — never mutates what's stored on the contributor row,
// only what's sent to the provider at send-time. A treasurer typing
// "0712345678" (the format everyone actually types) into the contributor
// form is the expected, common case, not an edge case — sending that
// unnormalized straight to Beem is a very plausible reason a real SMS
// send would fail silently before this fix.
//
// Accepts, in any of these written forms (spaces/dashes tolerated):
//   07XXXXXXXX / 06XXXXXXXX        (10-digit local)
//   2557XXXXXXXX / 2556XXXXXXXX     (12-digit, country code, no +)
//   +2557XXXXXXXX / +2556XXXXXXXX   (with +)
// Returns null (never throws) for anything that doesn't match a
// recognizable Tanzanian mobile shape — the caller treats that as a
// send-time failure, not a crash.
export function normalizeTzPhone(raw) {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[^\d]/g, '');

  if (digits.length === 12 && digits.startsWith('255') && /^255[67]/.test(digits)) {
    return digits;
  }
  if (digits.length === 10 && /^0[67]/.test(digits)) {
    return `255${digits.slice(1)}`;
  }
  if (digits.length === 9 && /^[67]/.test(digits)) {
    return `255${digits}`;
  }
  return null;
}

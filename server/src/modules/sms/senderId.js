// Sender-ID hygiene for the Beem payload.
//
// Beem registers and approves an EXACT sender-ID string. If `source_addr`
// does not match that approved value byte for byte, Beem answers 403
// ("Forbidden") — valid credentials, but not authorised to send as this
// sender — which is the rejection loop this module exists to stop.
//
// Deliberately kept pure (no env import, no I/O) so config/env.js can call
// it without a cycle and so it is unit-testable on its own.

// The characters an operator realistically leaves around a .env value.
// Handled explicitly rather than hoped away:
//   BEEM_SENDER_ID=ClixInvite␣      ← trailing space, invisible in an editor
//   BEEM_SENDER_ID="ClixInvite"     ← quotes dotenv only strips when they match
//   BEEM_SENDER_ID=ClixInvite\r     ← CRLF .env edited on Windows
// Any one of these is sent verbatim to Beem and fails the exact-match test
// while looking completely correct in the file.
const WRAPPING_QUOTES = /^(['"`])(.*)\1$/s;

/**
 * Canonical form of a configured sender ID.
 *
 * What it DOES fix (all lossless, all zero-risk):
 *   · strips surrounding quotes an operator typed by hand
 *   · strips leading/trailing whitespace, including \r from a CRLF .env
 *   · collapses internal whitespace runs to a single space
 *
 * What it deliberately does NOT do: change case.
 *
 * Sender IDs are approved case-sensitively on Beem's side and this process
 * has no way to know which casing was registered. "clix invite" and
 * "Clix Invite" are both plausible approved values, so forcing either
 * direction would silently BREAK a correctly-configured deployment to fix a
 * misconfigured one — trading a loud, diagnosable 403 for a quiet wrong
 * answer. The configured value stays authoritative; `senderIdWarning()`
 * reports anything suspicious instead of guessing.
 */
export function normalizeSenderId(raw) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  const quoted = value.match(WRAPPING_QUOTES);
  if (quoted) value = quoted[2].trim();
  return value.replace(/\s+/g, ' ');
}

/**
 * Describes why a sender ID is likely to be rejected, or null when it looks
 * conventional. Reported, never auto-corrected — see normalizeSenderId.
 */
export function senderIdWarning(senderId) {
  if (!senderId) return 'is not set — BEEM_SENDER_ID is empty, so Beem has no approved sender to send as';
  if (/\s/.test(senderId)) {
    return (
      `contains a space ("${senderId}") — most SMS gateways reject spaces in an alphanumeric sender ID; ` +
      `if Beem approved it without one, set BEEM_SENDER_ID="${senderId.replace(/\s+/g, '')}"`
    );
  }
  if (senderId.length > 11) return `is ${senderId.length} characters — GSM alphanumeric sender IDs are capped at 11`;
  if (!/^[A-Za-z0-9]+$/.test(senderId)) return `contains a character other than letters/digits ("${senderId}")`;
  return null;
}

/**
 * True when the value changed under normalisation — i.e. the raw .env value
 * would NOT have matched Beem's approved string even though it looks right
 * in the file. Worth telling the operator about explicitly, because this is
 * the failure mode that is impossible to see by reading the config.
 */
export function wasNormalized(raw, normalized) {
  return typeof raw === 'string' && raw !== normalized;
}

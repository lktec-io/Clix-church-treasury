import crypto from 'node:crypto';

// A 4-digit numeric PIN, matching the format in the client's own sample
// registration SMS ("Neno la siri ... ni: 7777"). Generated with
// crypto.randomInt (cryptographically strong), never Math.random — the
// same standard the codebase already holds refresh tokens to
// (auth/tokens.js#generateRefreshToken).
export function generatePin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

// Deliberately separate signing/verification from modules/auth/tokens.js's
// signAccessToken/verifyAccessToken rather than generalizing them to take a
// subject type — a member token must never be structurally interchangeable
// with a staff token even by accident. Same secret (HS256, same algorithm
// allow-list, same defense-in-depth reasoning as tokens.js), but the `kind`
// claim is checked explicitly on every verify, and the JWT `sub` is
// prefixed ("member:123") so the two subject spaces can never collide.
// Raw refresh tokens / hashing reuse generateRefreshToken/hashToken/
// refreshTokenExpiryDate from ../auth/tokens.js directly — that part of the
// primitive has nothing staff-specific about it.
export function signMemberAccessToken({ contributorId, tenantId }) {
  return jwt.sign({ tenantId, kind: 'member' }, env.jwt.accessSecret, {
    subject: `member:${contributorId}`,
    expiresIn: env.jwt.accessTokenTtl,
    algorithm: 'HS256',
  });
}

export function verifyMemberAccessToken(token) {
  const payload = jwt.verify(token, env.jwt.accessSecret, { algorithms: ['HS256'] });
  if (payload.kind !== 'member' || typeof payload.sub !== 'string' || !payload.sub.startsWith('member:')) {
    throw new Error('Not a member access token');
  }
  return { contributorId: Number(payload.sub.slice('member:'.length)), tenantId: payload.tenantId };
}

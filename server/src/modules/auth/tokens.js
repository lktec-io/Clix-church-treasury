import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export function signAccessToken({ userId, tenantId, roles }) {
  return jwt.sign({ tenantId, roles }, env.jwt.accessSecret, {
    subject: String(userId),
    expiresIn: env.jwt.accessTokenTtl,
  });
}

export function verifyAccessToken(token) {
  const payload = jwt.verify(token, env.jwt.accessSecret);
  return { userId: Number(payload.sub), tenantId: payload.tenantId, roles: payload.roles ?? [] };
}

// Refresh tokens are opaque, high-entropy random values — never JWTs. Only
// their SHA-256 hash is ever stored (SECURITY_ARCHITECTURE.md §2), mirroring
// how passwords are handled: the raw value exists only in the client's hands.
export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function refreshTokenExpiryDate() {
  const expires = new Date();
  expires.setDate(expires.getDate() + env.refreshToken.ttlDays);
  return expires;
}

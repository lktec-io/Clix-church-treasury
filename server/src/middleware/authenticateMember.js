import { unauthenticated } from '../errors/AppError.js';
import { verifyMemberAccessToken } from '../modules/memberAuth/memberTokens.js';

// The member-portal equivalent of authenticate.js — deliberately a
// separate function, not a parameterized version of the staff one, so a
// staff access token can never be accepted here even if someone tried
// (verifyMemberAccessToken independently rejects any token without
// `kind: 'member'`). Attaches req.memberAuth = { contributorId, tenantId },
// never req.auth — the two request shapes must stay visibly distinct so a
// route can't accidentally trust the wrong one.
export function authenticateMember(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(unauthenticated('Missing bearer token'));
  }
  const token = header.slice('Bearer '.length);
  try {
    req.memberAuth = verifyMemberAccessToken(token);
    next();
  } catch {
    next(unauthenticated('Invalid or expired token'));
  }
}

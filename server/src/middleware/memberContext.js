import { unauthenticated } from '../errors/AppError.js';

// The member-portal equivalent of tenantContext.js. Derives req.tenantId
// AND req.contributorId from req.memberAuth only — never from
// params/query/body — so every member-scoped route can filter every query
// by req.contributorId and trust it completely (this is the concrete
// backend enforcement behind "a member must never access another member's
// data by editing the URL").
export function memberContext(req, res, next) {
  const { tenantId, contributorId } = req.memberAuth ?? {};
  if (!tenantId || !contributorId) {
    return next(unauthenticated('No member context on request'));
  }
  req.tenantId = tenantId;
  req.contributorId = contributorId;
  next();
}

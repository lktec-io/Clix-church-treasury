// The roles allowed to decide an expense — approve, reject, return, or
// release payment.
//
// MIRRORS server/src/middleware/rbac.js#APPROVAL_ROLES, which is the rule
// that actually holds: the server re-derives these from the database on
// every request. This copy exists only so the Approvals Room can avoid
// offering a button that is certain to come back 403. If the two ever drift,
// the server wins and the user sees a clear 403 — never a silent success.
//
// "Admin" in this product is the Super Administrator role; there is no role
// literally named Admin.
export const APPROVAL_ROLES = ['Super Administrator', 'Senior Treasurer'];

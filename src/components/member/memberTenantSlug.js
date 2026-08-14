// A church slug is not sensitive (it's already visible in the shareable
// portal link itself, e.g. treasurer.clixworks.co.tz/member/mwamoto) — this
// is purely a UX convenience so a returning member's login form is
// pre-addressed to their own church without them re-typing/re-navigating
// the link, not a security boundary.
export const MEMBER_TENANT_SLUG_KEY = 'clix_member_tenant_slug';

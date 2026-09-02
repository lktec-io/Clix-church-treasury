// The one internal tenant that holds platform-administrator accounts —
// never a real church. Defined here, server-side, as the single source of
// truth for every consumer: the bootstrap script that creates it, the
// platform-login route that resolves it, and the tenant-management
// service that must keep it out of the tenant list and refuse to suspend
// it. The frontend deliberately does NOT know this value — it calls
// /auth/platform-login with only an email + password and the server
// supplies the tenant itself.
export const PLATFORM_TENANT_SLUG = 'clix-platform';
export const PLATFORM_TENANT_NAME = 'Clix Platform (internal)';

// Platform admins live in the internal tenant above, so it must never be
// manageable as if it were a customer church: listing it invites
// confusion, and suspending it would immediately lock every platform
// administrator out of /platform with no in-product way back in (login
// refuses a non-active tenant), recoverable only by direct database
// access. Both are blocked in platform.service.js.
export function isPlatformTenantSlug(slug) {
  return slug === PLATFORM_TENANT_SLUG;
}

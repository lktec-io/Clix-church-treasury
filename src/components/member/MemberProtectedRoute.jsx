import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useMemberAuth } from '../../context/MemberAuthContext.jsx';
import { MEMBER_TENANT_SLUG_KEY } from './memberTenantSlug.js';

// Mirrors ProtectedRoute.jsx exactly. Protected member pages carry no
// :tenantSlug in their own path (the session's JWT already carries tenant
// context — see server/src/modules/memberAuth/memberTokens.js), so on a
// forced-logout redirect this falls back to the slug the member last used
// (stashed at login time, see memberTenantSlug.js) so they land back on
// their own church's login form rather than a bare, tenant-less one.
export default function MemberProtectedRoute() {
  const { status } = useMemberAuth();
  const location = useLocation();

  if (status === 'checking') {
    return <div className="empty-state">Loading…</div>;
  }

  if (status === 'anonymous') {
    const lastSlug = localStorage.getItem(MEMBER_TENANT_SLUG_KEY);
    return <Navigate to={lastSlug ? `/member/${lastSlug}` : '/member'} replace state={{ from: location }} />;
  }

  return <Outlet />;
}

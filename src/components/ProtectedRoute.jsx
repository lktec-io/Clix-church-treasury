import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Frontend route-gating is UX only — the real authorization boundary is the
// backend's RBAC middleware (docs/SECURITY_ARCHITECTURE.md §3). Hiding a
// nav link or redirecting away from a page here never substitutes for a
// permission check the API itself doesn't also enforce.
export default function ProtectedRoute() {
  const { status, hasPermission } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return <div className="empty-state">Loading…</div>;
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // A platform administrator holds ONLY platform.manage — no financial or
  // tenant permissions at all (permissionCatalog.js). Every page in this
  // tree is church-scoped, so landing here gives them an empty shell whose
  // fetches all 403. LoginPage already routes them to /platform after
  // sign-in; this covers the other ways in — a bookmark, a typed URL, a
  // page reload on "/", or the catch-all redirect in App.jsx.
  //
  // Uses hasPermission() — the SAME predicate PlatformProtectedRoute tests
  // to send a non-platform user back here. If these two ever disagreed
  // about one session, the pair would bounce it between "/" and "/platform"
  // forever, so they must be the identical check, not merely equivalent
  // ones.
  if (hasPermission('platform.manage')) {
    return <Navigate to="/platform" replace />;
  }

  return <Outlet />;
}

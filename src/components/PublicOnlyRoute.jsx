import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// The inverse of ProtectedRoute — wraps routes that only make sense for a
// signed-out visitor (login, register). An already-authenticated user
// hitting either is sent to their landing page instead of being shown the
// form again.
//
// Deliberately does NOT wait on status === 'checking' the way
// ProtectedRoute does: a protected page waiting briefly to avoid a
// login-flash for an already-authenticated user is worth it, but a public
// page (especially /register, the only way a brand-new church can ever
// get in) must never be held up by the silent refresh-token check —
// render immediately, and only redirect once we positively know the
// visitor is already authenticated.
export default function PublicOnlyRoute() {
  const { status, hasPermission } = useAuth();

  if (status === 'authenticated') {
    // A platform admin's landing page is /platform, never the tenant
    // dashboard — they may not even hold any tenant-scoped permission at
    // all (platform.manage carries no financial permissions; see
    // permissionCatalog.js), so redirecting them to "/" the way every
    // other authenticated user is could land on a dashboard with nothing
    // visible on it.
    return <Navigate to={hasPermission('platform.manage') ? '/platform' : '/'} replace />;
  }

  return <Outlet />;
}

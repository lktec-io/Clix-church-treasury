import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Frontend gating here is UX only, exactly like ProtectedRoute.jsx's own
// comment says — the real boundary is the backend's requirePlatformAdmin
// (server/src/middleware/rbac.js), applied to every /api/v1/platform/*
// route regardless of what this component does. This component's only
// job is sending the right person to the right place without a jarring
// 403 page: anonymous -> /login, authenticated-but-not-a-platform-admin
// -> their own tenant dashboard (not an error state — a tenant admin
// hitting /platform by URL is not doing anything wrong, they just don't
// belong here), platform admin -> through.
export default function PlatformProtectedRoute() {
  const { status, hasPermission } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return <div className="empty-state">Loading…</div>;
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!hasPermission('platform.manage')) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

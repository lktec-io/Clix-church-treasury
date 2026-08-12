import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Frontend route-gating is UX only — the real authorization boundary is the
// backend's RBAC middleware (docs/SECURITY_ARCHITECTURE.md §3). Hiding a
// nav link or redirecting away from a page here never substitutes for a
// permission check the API itself doesn't also enforce.
export default function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return <div className="empty-state">Loading…</div>;
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

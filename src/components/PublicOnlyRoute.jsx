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
  const { status } = useAuth();

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

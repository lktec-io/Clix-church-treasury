import { useAuth } from '../context/AuthContext.jsx';

// UX convenience only — hides an action a user can't perform anyway, so the
// screen isn't cluttered with buttons that would just 403. The backend
// re-checks the same permission independently on every request regardless
// (docs/SECURITY_ARCHITECTURE.md §3) — this component is not the security boundary.
export default function PermissionGate({ permission, children }) {
  const { hasPermission } = useAuth();
  if (!hasPermission(permission)) return null;
  return children;
}

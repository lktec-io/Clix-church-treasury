import { Navigate, Outlet } from 'react-router-dom';
import { useMemberAuth } from '../../context/MemberAuthContext.jsx';

// Mirrors PublicOnlyRoute.jsx exactly, for the member login route.
export default function MemberPublicOnlyRoute() {
  const { status } = useMemberAuth();

  if (status === 'authenticated') {
    return <Navigate to="/member/dashboard" replace />;
  }

  return <Outlet />;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { memberApiClient, setMemberAccessToken, setOnMemberAuthExpired } from '../api/memberClient.js';
import { memberAuthApi } from '../api/memberEndpoints.js';
import { unwrapApiError } from '../api/client.js';

const MemberAuthContext = createContext(null);

// Mirrors AuthContext.jsx's shape exactly, but for the member-portal
// subject type — deliberately a fully separate context/provider rather
// than a "mode" flag on AuthContext, matching memberClient.js's reasoning:
// a member session must never be structurally confusable with a staff
// session, even in the same browser tab.
export function MemberAuthProvider({ children }) {
  const [session, setSession] = useState(null); // { contributor, mustChangePin } | null
  const [status, setStatus] = useState('checking'); // 'checking' | 'authenticated' | 'anonymous'
  const { pathname } = useLocation();

  const clearSession = useCallback(() => {
    setMemberAccessToken(null);
    setSession(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    setOnMemberAuthExpired(clearSession);
  }, [clearSession]);

  // Session restore is SCOPED TO THE MEMBER PORTAL.
  //
  // This provider is mounted app-wide (main.jsx) so that a member session
  // and a staff session can coexist. It used to bootstrap unconditionally on
  // mount, which meant every staff and platform-admin page load also fired
  // POST /member/auth/refresh — a guaranteed 401 for anyone who is not a
  // member, on every single load. It never broke the staff session (the two
  // Axios clients hold entirely separate token state), but it filled the
  // console with authentication failures that masked real errors.
  //
  // Now the refresh only runs while the user is actually inside /member.
  // Outside it, we settle straight to 'anonymous' with no network call.
  const bootstrapped = useRef(false);
  const isMemberScope = typeof pathname === 'string' && (pathname === '/member' || pathname.startsWith('/member/'));

  useEffect(() => {
    if (!isMemberScope) {
      // Never downgrade an already-established session — a member who
      // navigates out of the portal and back must not be logged out.
      if (!bootstrapped.current) setStatus('anonymous');
      return undefined;
    }
    if (bootstrapped.current) return undefined;
    bootstrapped.current = true;

    let cancelled = false;
    // Back to 'checking' before the request: if the app first loaded on a
    // non-member route we settled to 'anonymous' above, and entering the
    // portal now would otherwise let MemberProtectedRoute bounce the user
    // to the login screen before this refresh has had a chance to answer.
    setStatus('checking');
    (async () => {
      try {
        const { accessToken } = (await memberApiClient.post('/member/auth/refresh')).data.data;
        if (cancelled) return;
        setMemberAccessToken(accessToken);
        const me = await memberApiClient.get('/member/auth/me').then((res) => res.data.data);
        if (cancelled) return;
        setSession(me);
        setStatus('authenticated');
      } catch {
        if (!cancelled) {
          setSession(null);
          setStatus('anonymous');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isMemberScope]);

  const login = useCallback(async ({ tenantSlug, memberNumber, pin }) => {
    try {
      const result = await memberAuthApi.login({ tenantSlug, memberNumber, pin });
      setMemberAccessToken(result.accessToken);
      const me = { contributor: result.contributor, mustChangePin: result.mustChangePin };
      setSession(me);
      setStatus('authenticated');
      return me;
    } catch (error) {
      throw unwrapApiError(error);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await memberAuthApi.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const refreshSession = useCallback(async () => {
    const me = await memberApiClient.get('/member/auth/me').then((res) => res.data.data);
    setSession(me);
    return me;
  }, []);

  const value = useMemo(
    () => ({ status, session, login, logout, refreshSession }),
    [status, session, login, logout, refreshSession]
  );

  return <MemberAuthContext.Provider value={value}>{children}</MemberAuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMemberAuth() {
  const ctx = useContext(MemberAuthContext);
  if (!ctx) throw new Error('useMemberAuth must be used within a MemberAuthProvider');
  return ctx;
}

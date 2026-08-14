import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

  const clearSession = useCallback(() => {
    setMemberAccessToken(null);
    setSession(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    setOnMemberAuthExpired(clearSession);
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

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

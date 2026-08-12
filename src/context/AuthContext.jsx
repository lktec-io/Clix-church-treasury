import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiClient, setAccessToken, setOnAuthExpired, unwrapApiError } from '../api/client.js';
import { authApi } from '../api/endpoints.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // { user, roles, permissions } | null
  const [status, setStatus] = useState('checking'); // 'checking' | 'authenticated' | 'anonymous'

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setSession(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    setOnAuthExpired(clearSession);
  }, [clearSession]);

  // On mount: the access token lives only in memory, so a page reload lost
  // it — try the refresh cookie silently before deciding the user is logged
  // out (docs/API_ARCHITECTURE.md §6).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { accessToken } = (await apiClient.post('/auth/refresh')).data.data;
        if (cancelled) return;
        setAccessToken(accessToken);
        const me = await apiClient.get('/auth/me').then((res) => res.data.data);
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

  const login = useCallback(async ({ tenantSlug, email, password }) => {
    try {
      const result = await authApi.login({ tenantSlug, email, password });
      setAccessToken(result.accessToken);
      // login's response only carries roles, not the full permission list
      // (auth.controller.js#login) — /me is the single source for the
      // complete session shape, used both here and on page-reload restore.
      const me = await apiClient.get('/auth/me').then((res) => res.data.data);
      setSession(me);
      setStatus('authenticated');
      return me;
    } catch (error) {
      throw unwrapApiError(error);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const hasPermission = useCallback(
    (permission) => session?.permissions?.includes(permission) ?? false,
    [session]
  );

  const value = useMemo(
    () => ({ status, session, login, logout, hasPermission }),
    [status, session, login, logout, hasPermission]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Co-located with AuthProvider deliberately — the context and its hook are
// one unit. Costs Fast Refresh a full reload on edit to this file instead
// of a hot patch; doesn't affect production behavior.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

import axios from 'axios';

// VITE_API_BASE_URL should always be set explicitly — .env.production
// (committed, not a secret) sets it for every `vite build`, so this
// fallback should never actually fire in a real deployment. It exists as
// a second line of defense against the exact incident that already
// happened once: a build run without that value present silently baked
// in a hardcoded localhost URL, and the browser tried to reach a backend
// port on the visitor's own machine instead of the real API.
//
// The fallback itself is mode-aware rather than a single hardcoded
// value: `import.meta.env.DEV` is Vite's own build-time flag (true only
// for `vite dev`, always false for any `vite build`, dev or prod mode).
// In dev, default to the local backend port. In any built bundle where
// the explicit URL is somehow still missing, derive same-origin instead
// of guessing a port — this architecture always serves the frontend and
// API from the same origin in production (Nginx routes /api/* to the
// backend, see docs/API_ARCHITECTURE.md §Production), so same-origin is
// the one fallback that is actually correct for a real deployment rather
// than one that would silently point at the wrong host again.
const baseURL =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? 'http://localhost:4005/api/v1' : `${window.location.origin}/api/v1`);

// The access token lives in memory only — never localStorage/sessionStorage,
// so it can't be read by an XSS payload the way a stored token could
// (docs/SECURITY_ARCHITECTURE.md §2). The refresh token never touches JS at
// all; it's an httpOnly cookie the browser sends automatically.
let accessToken = null;
let onAuthExpired = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

// Registered by AuthContext — called when refresh fails, so the app can
// clear session state and redirect to login without this module needing
// to know about React.
export function setOnAuthExpired(handler) {
  onAuthExpired = handler;
}

export const apiClient = axios.create({
  baseURL,
  withCredentials: true, // sends the refresh-token cookie
});

apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

let refreshPromise = null;

async function refreshAccessToken() {
  // Coalesce concurrent 401s into a single refresh call rather than firing
  // one per failed request.
  if (!refreshPromise) {
    refreshPromise = apiClient
      .post('/auth/refresh')
      .then((res) => {
        const token = res.data.data.accessToken;
        setAccessToken(token);
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const isAuthEndpoint = config?.url?.startsWith('/auth/');
    if (response?.status === 401 && !config._retried && !isAuthEndpoint) {
      config._retried = true;
      try {
        const token = await refreshAccessToken();
        config.headers.Authorization = `Bearer ${token}`;
        return apiClient(config);
      } catch (refreshError) {
        setAccessToken(null);
        onAuthExpired?.();
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

// Normalizes the {success, data} / {success, error} envelope
// (docs/API_ARCHITECTURE.md §4) into a plain thrown Error with .code/.fields
// for callers that don't want to inspect the raw Axios error shape.
export function unwrapApiError(error) {
  const apiError = error?.response?.data?.error;
  if (apiError) {
    const err = new Error(apiError.message);
    err.code = apiError.code;
    err.fields = apiError.fields;
    return err;
  }
  return error;
}

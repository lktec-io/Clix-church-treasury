import axios from 'axios';
import { baseURL } from './client.js';

// A fully separate axios instance from client.js's apiClient — deliberately
// not a shared client with a "mode" flag. A staff session and a member
// session must be able to coexist in the same browser tab (or at least
// never silently clobber each other's token), and the two APIs refresh
// against different endpoints (/auth/refresh vs /member/auth/refresh) with
// different httpOnly cookies (refreshToken vs memberRefreshToken, see
// server/src/modules/memberAuth/memberAuth.controller.js). Mirrors
// client.js's shape exactly otherwise — same in-memory-only token rule
// (SECURITY_ARCHITECTURE.md §2), same single-flight refresh coalescing.
let memberAccessToken = null;
let onMemberAuthExpired = null;

export function setMemberAccessToken(token) {
  memberAccessToken = token;
}

export function getMemberAccessToken() {
  return memberAccessToken;
}

export function setOnMemberAuthExpired(handler) {
  onMemberAuthExpired = handler;
}

export const memberApiClient = axios.create({
  baseURL,
  withCredentials: true,
});

memberApiClient.interceptors.request.use((config) => {
  if (memberAccessToken) {
    config.headers.Authorization = `Bearer ${memberAccessToken}`;
  }
  return config;
});

let refreshPromise = null;

async function refreshMemberAccessToken() {
  if (!refreshPromise) {
    refreshPromise = memberApiClient
      .post('/member/auth/refresh')
      .then((res) => {
        const token = res.data.data.accessToken;
        setMemberAccessToken(token);
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

memberApiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const isAuthEndpoint = config?.url?.startsWith('/member/auth/');
    if (response?.status === 401 && !config._retried && !isAuthEndpoint) {
      config._retried = true;
      try {
        const token = await refreshMemberAccessToken();
        config.headers.Authorization = `Bearer ${token}`;
        return memberApiClient(config);
      } catch (refreshError) {
        setMemberAccessToken(null);
        onMemberAuthExpired?.();
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

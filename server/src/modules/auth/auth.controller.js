import { env } from '../../config/env.js';
import * as authService from './auth.service.js';
import { validateLogin, validateRegisterTenant, validateEmail, validatePassword } from './auth.validator.js';
import { validationError } from '../../errors/AppError.js';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: env.refreshToken.ttlDays * 24 * 60 * 60 * 1000,
};

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, REFRESH_COOKIE_OPTIONS);
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
}

export async function registerTenant(req, res, next) {
  try {
    const data = validateRegisterTenant(req.body ?? {});
    const result = await authService.registerTenant(data, { ipAddress: req.ip });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const data = validateLogin(req.body ?? {});
    const result = await authService.login({ ...data, ipAddress: req.ip });
    setRefreshCookie(res, result.refreshToken);
    res.json({
      success: true,
      data: { accessToken: result.accessToken, user: result.user, roles: result.roles },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    const result = await authService.refresh({ rawRefreshToken, ipAddress: req.ip });
    setRefreshCookie(res, result.refreshToken);
    res.json({ success: true, data: { accessToken: result.accessToken } });
  } catch (err) {
    clearRefreshCookie(res);
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    await authService.logout({ rawRefreshToken });
    clearRefreshCookie(res);
    res.json({ success: true, data: { loggedOut: true } });
  } catch (err) {
    next(err);
  }
}

export async function requestPasswordReset(req, res, next) {
  try {
    const tenantSlug = req.body?.tenantSlug;
    const email = req.body?.email;
    if (typeof tenantSlug !== 'string' || tenantSlug.trim().length === 0) {
      throw validationError('Invalid payload', { tenantSlug: 'tenantSlug is required' });
    }
    validateEmail(email);
    const result = await authService.requestPasswordReset({
      tenantSlug: tenantSlug.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    const result = await authService.getCurrentUser(req.tenantId, req.auth.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const rawToken = req.body?.token;
    const newPassword = req.body?.newPassword;
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw validationError('Invalid payload', { token: 'token is required' });
    }
    validatePassword(newPassword, 'newPassword');
    const result = await authService.resetPassword({ rawToken, newPassword });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

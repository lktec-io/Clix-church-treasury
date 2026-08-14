import { env } from '../../config/env.js';
import * as memberAuthService from './memberAuth.service.js';
import { validateMemberLogin, validateChangePin } from './memberAuth.validator.js';

const REFRESH_COOKIE_NAME = 'memberRefreshToken';
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'strict',
  path: '/api/v1/member',
  maxAge: env.refreshToken.ttlDays * 24 * 60 * 60 * 1000,
};

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, REFRESH_COOKIE_OPTIONS);
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/member' });
}

export async function login(req, res, next) {
  try {
    const data = validateMemberLogin(req.body ?? {});
    const result = await memberAuthService.login({ ...data, ipAddress: req.ip });
    setRefreshCookie(res, result.refreshToken);
    res.json({
      success: true,
      data: { accessToken: result.accessToken, contributor: result.contributor, mustChangePin: result.mustChangePin },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    const result = await memberAuthService.refresh({ rawRefreshToken, ipAddress: req.ip });
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
    await memberAuthService.logout({ rawRefreshToken });
    clearRefreshCookie(res);
    res.json({ success: true, data: { loggedOut: true } });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    const result = await memberAuthService.getCurrentMember(req.memberAuth.tenantId, req.memberAuth.contributorId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function changePin(req, res, next) {
  try {
    const data = validateChangePin(req.body ?? {});
    const contributor = await memberAuthService.changePin(req.memberAuth.tenantId, req.memberAuth.contributorId, data);
    res.json({ success: true, data: { contributor } });
  } catch (err) {
    next(err);
  }
}

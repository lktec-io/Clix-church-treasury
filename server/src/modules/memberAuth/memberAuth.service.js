import bcrypt from 'bcryptjs';
import { withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError, unauthenticated, notFound, validationError } from '../../errors/AppError.js';
import { tenantsRepository } from '../tenants/tenants.repository.js';
import { contributorsRepository } from '../contributors/contributors.repository.js';
import { contributorRefreshTokensRepository } from './contributorRefreshTokens.repository.js';
import { signMemberAccessToken } from './memberTokens.js';
import { generateRefreshToken, hashToken, refreshTokenExpiryDate } from '../auth/tokens.js';
import { recordAuditLog } from '../audit/auditLog.service.js';

const BCRYPT_COST = 10;
// One generic message for every failure mode (unknown tenant, unknown
// member number, wrong PIN) — same no-enumeration principle as
// auth.service.js's GENERIC_LOGIN_ERROR.
const GENERIC_LOGIN_ERROR = 'Invalid member number or PIN';

function toPublicContributor(contributor) {
  // eslint-disable-next-line no-unused-vars
  const { pin_hash, failed_pin_attempts, pin_locked_until, ...publicContributor } = contributor;
  return publicContributor;
}

async function issueMemberSession(contributor, connection) {
  const accessToken = signMemberAccessToken({ contributorId: contributor.id, tenantId: contributor.tenant_id });
  const rawRefreshToken = generateRefreshToken();
  const tokenId = await contributorRefreshTokensRepository.create(
    contributor.id,
    hashToken(rawRefreshToken),
    refreshTokenExpiryDate(),
    connection
  );
  return { accessToken, refreshToken: rawRefreshToken, tokenId };
}

export async function login({ tenantSlug, memberNumber, pin, ipAddress }) {
  return withTransaction(async (connection) => {
    const tenant = await tenantsRepository.findBySlug(tenantSlug, connection);
    if (!tenant || tenant.status !== 'active') throw unauthenticated(GENERIC_LOGIN_ERROR);

    const contributor = await contributorsRepository.findByMemberNumber(tenant.id, memberNumber, connection);
    if (!contributor || !contributor.is_active || !contributor.portal_enabled_at || !contributor.pin_hash) {
      throw unauthenticated(GENERIC_LOGIN_ERROR);
    }

    if (contributor.pin_locked_until && new Date(contributor.pin_locked_until) > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 'Account temporarily locked due to repeated failed attempts', {
        status: 423,
      });
    }

    const matches = await bcrypt.compare(pin, contributor.pin_hash);
    if (!matches) {
      const attempts = contributor.failed_pin_attempts + 1;
      const lockedUntil =
        attempts >= env.login.maxAttempts ? new Date(Date.now() + env.login.lockoutMinutes * 60_000) : null;
      await contributorsRepository.update(
        tenant.id,
        contributor.id,
        { failed_pin_attempts: attempts, pin_locked_until: lockedUntil },
        connection
      );
      await recordAuditLog(
        {
          tenantId: tenant.id,
          actorUserId: null,
          action: 'member_auth.login_failed',
          entityType: 'contributors',
          entityId: contributor.id,
          ipAddress,
        },
        connection
      );
      throw unauthenticated(GENERIC_LOGIN_ERROR);
    }

    await contributorsRepository.update(
      tenant.id,
      contributor.id,
      { failed_pin_attempts: 0, pin_locked_until: null },
      connection
    );
    const session = await issueMemberSession(contributor, connection);

    await recordAuditLog(
      {
        tenantId: tenant.id,
        actorUserId: null,
        action: 'member_auth.login_success',
        entityType: 'contributors',
        entityId: contributor.id,
        ipAddress,
      },
      connection
    );

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      contributor: toPublicContributor({ ...contributor, failed_pin_attempts: 0, pin_locked_until: null }),
      mustChangePin: contributor.must_change_pin,
    };
  });
}

export async function refresh({ rawRefreshToken, ipAddress }) {
  if (!rawRefreshToken) throw unauthenticated('Missing refresh token');

  return withTransaction(async (connection) => {
    const tokenHash = hashToken(rawRefreshToken);
    const record = await contributorRefreshTokensRepository.findByHash(tokenHash, connection);
    if (!record) throw unauthenticated('Invalid refresh token');

    if (record.revoked_at) {
      await contributorRefreshTokensRepository.revokeChainFrom(record.id, connection);
      await recordAuditLog(
        {
          actorUserId: null,
          action: 'member_auth.refresh_reuse_detected',
          entityType: 'contributor_refresh_tokens',
          entityId: record.id,
          ipAddress,
        },
        connection
      );
      throw unauthenticated('Refresh token has already been used');
    }

    if (new Date(record.expires_at) <= new Date()) {
      throw unauthenticated('Refresh token expired');
    }

    const contributor = await contributorsRepository.findByIdAnyTenant(record.contributor_id, connection);
    if (!contributor || !contributor.is_active || !contributor.portal_enabled_at) {
      throw unauthenticated('Account is no longer active');
    }

    const session = await issueMemberSession(contributor, connection);
    await contributorRefreshTokensRepository.revoke(record.id, connection);
    await contributorRefreshTokensRepository.setReplacement(record.id, session.tokenId, connection);

    return { accessToken: session.accessToken, refreshToken: session.refreshToken };
  });
}

export async function logout({ rawRefreshToken }) {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  const record = await contributorRefreshTokensRepository.findByHash(tokenHash);
  if (record && !record.revoked_at) {
    await contributorRefreshTokensRepository.revoke(record.id);
    await recordAuditLog({
      tenantId: null,
      actorUserId: null,
      action: 'member_auth.logout',
      entityType: 'contributor_refresh_tokens',
      entityId: record.id,
    });
  }
}

export async function getCurrentMember(tenantId, contributorId) {
  const contributor = await contributorsRepository.findById(tenantId, contributorId);
  if (!contributor) throw notFound('Contributor not found');
  return { contributor: toPublicContributor(contributor), mustChangePin: contributor.must_change_pin };
}

const PIN_RE = /^\d{4}$/;

export async function changePin(tenantId, contributorId, { currentPin, newPin }) {
  if (!PIN_RE.test(newPin)) {
    throw validationError('Invalid payload', { newPin: 'must be exactly 4 digits' });
  }
  const contributor = await contributorsRepository.findById(tenantId, contributorId);
  if (!contributor) throw notFound('Contributor not found');

  const matches = await bcrypt.compare(currentPin, contributor.pin_hash);
  if (!matches) {
    throw unauthenticated('Current PIN is incorrect');
  }

  const pinHash = await bcrypt.hash(newPin, BCRYPT_COST);
  const updated = await contributorsRepository.update(tenantId, contributorId, {
    pin_hash: pinHash,
    must_change_pin: false,
  });

  await recordAuditLog({
    tenantId,
    actorUserId: null,
    action: 'member_auth.pin_changed',
    entityType: 'contributors',
    entityId: contributorId,
  });

  return toPublicContributor(updated);
}

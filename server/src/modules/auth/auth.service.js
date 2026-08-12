import bcrypt from 'bcryptjs';
import { withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError, conflict, notFound, unauthenticated } from '../../errors/AppError.js';
import { tenantsRepository } from '../tenants/tenants.repository.js';
import { createTenantWithConnection } from '../tenants/tenants.service.js';
import { usersRepository } from '../users/users.repository.js';
import { rolesRepository } from '../roles/roles.repository.js';
import { userRolesRepository } from '../roles/userRoles.repository.js';
import { permissionsRepository } from '../permissions/permissions.repository.js';
import { refreshTokensRepository } from './refreshTokens.repository.js';
import { passwordResetTokensRepository } from './passwordResetTokens.repository.js';
import { recordAuditLog } from '../audit/auditLog.service.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiryDate,
} from './tokens.js';

const BCRYPT_COST = 10;
const GENERIC_LOGIN_ERROR = 'Invalid email or password';

function toPublicUser(user) {
  // Never include password_hash in an API response (SECURITY_ARCHITECTURE.md §2).
  // eslint-disable-next-line no-unused-vars
  const { password_hash, failed_login_attempts, locked_until, ...publicUser } = user;
  return publicUser;
}

async function issueSession(user, connection) {
  const roles = await rolesRepository.listForTenant(user.tenant_id, connection);
  const roleIds = new Set(await userRolesRepository.listRoleIdsForUser(user.id, connection));
  const roleNames = roles.filter((r) => roleIds.has(r.id)).map((r) => r.name);

  const accessToken = signAccessToken({ userId: user.id, tenantId: user.tenant_id, roles: roleNames });

  const rawRefreshToken = generateRefreshToken();
  const tokenId = await refreshTokensRepository.create(
    user.id,
    hashToken(rawRefreshToken),
    refreshTokenExpiryDate(),
    connection
  );

  return { accessToken, refreshToken: rawRefreshToken, tokenId, roles: roleNames };
}

// Church sign-up: tenant + church_settings + first admin user + Super
// Administrator role assignment, all in one transaction (docs/MASTER_TODO.md
// Phase 2). Requires the RBAC catalog (docs/db/seeds/seedRbacCatalog.js) to
// already be seeded — that's a deploy-time bootstrap step, not something this
// request performs itself.
export async function registerTenant({ churchName, adminEmail, adminPassword, adminFullName }, { ipAddress } = {}) {
  return withTransaction(async (connection) => {
    const tenant = await createTenantWithConnection(connection, { name: churchName });

    const existingUser = await usersRepository.findByEmail(tenant.id, adminEmail, connection);
    if (existingUser) {
      throw conflict('That email is already registered for this church');
    }

    const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_COST);
    const user = await usersRepository.create(
      tenant.id,
      { email: adminEmail, passwordHash, fullName: adminFullName, status: 'active' },
      connection
    );

    const superAdminRole = await rolesRepository.findSystemRoleByName('Super Administrator', connection);
    if (!superAdminRole) {
      throw new AppError(
        'RBAC_NOT_SEEDED',
        'System roles are not seeded — run the seed script before allowing tenant registration',
        { status: 500 }
      );
    }
    await userRolesRepository.assign(user.id, superAdminRole.id, connection);

    await recordAuditLog(
      {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: 'tenant.registered',
        entityType: 'tenants',
        entityId: tenant.id,
        ipAddress,
      },
      connection
    );

    return { tenant, user: toPublicUser(user) };
  });
}

export async function login({ tenantSlug, email, password, ipAddress }) {
  return withTransaction(async (connection) => {
    const tenant = await tenantsRepository.findBySlug(tenantSlug, connection);
    if (!tenant || tenant.status !== 'active') {
      throw unauthenticated(GENERIC_LOGIN_ERROR);
    }

    const user = await usersRepository.findByEmail(tenant.id, email, connection);
    if (!user || user.status !== 'active') {
      throw unauthenticated(GENERIC_LOGIN_ERROR);
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 'Account temporarily locked due to repeated failed logins', {
        status: 423,
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      const attempts = user.failed_login_attempts + 1;
      const lockedUntil =
        attempts >= env.login.maxAttempts
          ? new Date(Date.now() + env.login.lockoutMinutes * 60_000)
          : null;
      await usersRepository.recordFailedLogin(tenant.id, user.id, { attempts, lockedUntil }, connection);
      await recordAuditLog(
        {
          tenantId: tenant.id,
          actorUserId: user.id,
          action: 'auth.login_failed',
          entityType: 'users',
          entityId: user.id,
          ipAddress,
        },
        connection
      );
      throw unauthenticated(GENERIC_LOGIN_ERROR);
    }

    await usersRepository.recordSuccessfulLogin(tenant.id, user.id, connection);
    const session = await issueSession(user, connection);

    await recordAuditLog(
      {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: 'auth.login_success',
        entityType: 'users',
        entityId: user.id,
        ipAddress,
      },
      connection
    );

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: toPublicUser({ ...user, failed_login_attempts: 0, locked_until: null }),
      roles: session.roles,
    };
  });
}

export async function refresh({ rawRefreshToken, ipAddress }) {
  if (!rawRefreshToken) throw unauthenticated('Missing refresh token');

  return withTransaction(async (connection) => {
    const tokenHash = hashToken(rawRefreshToken);
    const record = await refreshTokensRepository.findByHash(tokenHash, connection);
    if (!record) throw unauthenticated('Invalid refresh token');

    if (record.revoked_at) {
      // Reuse of an already-rotated/revoked token — treat as theft: kill the
      // whole chain so a stolen token can't be replayed even once more.
      await refreshTokensRepository.revokeChainFrom(record.id, connection);
      await recordAuditLog(
        {
          actorUserId: record.user_id,
          action: 'auth.refresh_reuse_detected',
          entityType: 'refresh_tokens',
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

    const user = await usersRepository.findByIdAnyTenant(record.user_id, connection);
    if (!user || user.status !== 'active') {
      throw unauthenticated('Account is no longer active');
    }

    const session = await issueSession(user, connection);
    await refreshTokensRepository.revoke(record.id, connection);
    await refreshTokensRepository.setReplacement(record.id, session.tokenId, connection);

    return { accessToken: session.accessToken, refreshToken: session.refreshToken };
  });
}

export async function logout({ rawRefreshToken }) {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  const record = await refreshTokensRepository.findByHash(tokenHash);
  if (record && !record.revoked_at) {
    await refreshTokensRepository.revoke(record.id);
    await recordAuditLog({
      tenantId: null,
      actorUserId: record.user_id,
      action: 'auth.logout',
      entityType: 'refresh_tokens',
      entityId: record.id,
    });
  }
  // Always succeeds, even for an unknown/already-revoked token — logout is
  // idempotent by design and must not leak whether a token was valid.
}

export async function requestPasswordReset({ tenantSlug, email }) {
  const tenant = await tenantsRepository.findBySlug(tenantSlug);
  const user = tenant ? await usersRepository.findByEmail(tenant.id, email) : null;

  if (!user || user.status !== 'active') {
    // Always respond as if it worked — never confirm whether the account exists.
    return { requested: true };
  }

  const rawToken = generateRefreshToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + env.passwordReset.ttlMinutes * 60_000);

  await passwordResetTokensRepository.create(user.id, tokenHash, expiresAt);

  await recordAuditLog({
    tenantId: tenant.id,
    actorUserId: user.id,
    action: 'auth.password_reset_requested',
    entityType: 'users',
    entityId: user.id,
  });

  // No email delivery yet — Phase 2 stops at issuing the token. In
  // non-production, returning it directly lets the flow be exercised without
  // an email provider wired up.
  return env.isProduction ? { requested: true } : { requested: true, devToken: rawToken };
}

export async function resetPassword({ rawToken, newPassword }) {
  const tokenHash = hashToken(rawToken);
  const record = await passwordResetTokensRepository.findByHash(tokenHash);
  if (!record || record.used_at || new Date(record.expires_at) <= new Date()) {
    throw unauthenticated('Invalid or expired password reset token');
  }

  const user = await usersRepository.findByIdAnyTenant(record.user_id);
  if (!user) throw notFound('User not found');

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await usersRepository.setPasswordHash(user.tenant_id, user.id, passwordHash);
  if (user.status === 'invited') {
    // This flow doubles as "accept invite" — see users.service.js inviteUser().
    await usersRepository.setStatus(user.tenant_id, user.id, 'active');
  }
  await passwordResetTokensRepository.markUsed(record.id);
  // Force re-login on every device after a password reset.
  await refreshTokensRepository.revokeAllForUser(user.id);

  await recordAuditLog({
    tenantId: user.tenant_id,
    actorUserId: user.id,
    action: 'auth.password_reset_completed',
    entityType: 'users',
    entityId: user.id,
  });

  return { success: true };
}

export async function getEffectivePermissions(userId) {
  return permissionsRepository.listForUser(userId);
}

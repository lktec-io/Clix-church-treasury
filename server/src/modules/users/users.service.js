import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { conflict, forbidden, notFound } from '../../errors/AppError.js';
import { usersRepository } from './users.repository.js';
import { rolesRepository } from '../roles/roles.repository.js';
import { userRolesRepository } from '../roles/userRoles.repository.js';
import { passwordResetTokensRepository } from '../auth/passwordResetTokens.repository.js';
import { refreshTokensRepository } from '../auth/refreshTokens.repository.js';
import { recordAuditLog } from '../audit/auditLog.service.js';
import { generateRefreshToken, hashToken } from '../auth/tokens.js';

function toPublicUser(user) {
  // eslint-disable-next-line no-unused-vars
  const { password_hash, failed_login_attempts, locked_until, ...publicUser } = user;
  return publicUser;
}

export async function listUsers(tenantId) {
  const users = await usersRepository.findAllByTenant(tenantId);
  return users.map(toPublicUser);
}

export async function inviteUser(tenantId, { email, fullName }, actorUserId) {
  return withTransaction(async (connection) => {
    const existing = await usersRepository.findByEmail(tenantId, email, connection);
    if (existing) {
      throw conflict('A user with that email already exists for this church');
    }

    // Unusable random placeholder — the invitee sets their real password via
    // the password-reset-confirm flow, reused here as "accept invite".
    const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const user = await usersRepository.create(
      tenantId,
      { email, passwordHash: placeholderHash, fullName, status: 'invited' },
      connection
    );

    const rawToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + env.passwordReset.ttlMinutes * 60_000);
    await passwordResetTokensRepository.create(user.id, hashToken(rawToken), expiresAt, connection);

    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'user.invited',
        entityType: 'users',
        entityId: user.id,
      },
      connection
    );

    return {
      user: toPublicUser(user),
      // Only surfaced outside production until real email delivery exists.
      devInviteToken: env.isProduction ? undefined : rawToken,
    };
  });
}

export async function assignRole(tenantId, userId, roleId, actorUserId) {
  const user = await usersRepository.findById(tenantId, userId);
  if (!user) throw notFound('User not found');

  const role = await rolesRepository.findById(roleId);
  if (!role || (role.tenant_id !== null && role.tenant_id !== tenantId)) {
    throw notFound('Role not found');
  }

  await userRolesRepository.assign(userId, roleId);

  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'user.role_assigned',
    entityType: 'users',
    entityId: userId,
    after: { roleId, roleName: role.name },
  });

  return { userId, roleId };
}

export async function removeRole(tenantId, userId, roleId, actorUserId) {
  const user = await usersRepository.findById(tenantId, userId);
  if (!user) throw notFound('User not found');

  await userRolesRepository.remove(userId, roleId);

  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'user.role_removed',
    entityType: 'users',
    entityId: userId,
    before: { roleId },
  });

  return { userId, roleId };
}

export async function disableUser(tenantId, userId, actorUserId) {
  if (userId === actorUserId) {
    throw forbidden('You cannot disable your own account');
  }
  const user = await usersRepository.setStatus(tenantId, userId, 'disabled');
  if (!user) throw notFound('User not found');

  await refreshTokensRepository.revokeAllForUser(userId);

  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'user.disabled',
    entityType: 'users',
    entityId: userId,
  });

  return toPublicUser(user);
}

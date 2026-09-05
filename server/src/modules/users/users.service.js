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
import { PLATFORM_ONLY_ROLES, SUPER_ADMIN_ROLE } from '../../db/seeds/permissionCatalog.js';

function toPublicUser(user) {
  // eslint-disable-next-line no-unused-vars
  const { password_hash, failed_login_attempts, locked_until, ...publicUser } = user;
  return publicUser;
}

export async function listUsers(tenantId) {
  const users = await usersRepository.findAllByTenant(tenantId);
  const roleRows = await userRolesRepository.listRolesForUsers(users.map((u) => u.id));
  const rolesByUserId = new Map();
  for (const row of roleRows) {
    const list = rolesByUserId.get(row.user_id) ?? [];
    list.push({ id: row.role_id, name: row.role_name });
    rolesByUserId.set(row.user_id, list);
  }
  return users.map((user) => ({ ...toPublicUser(user), roles: rolesByUserId.get(user.id) ?? [] }));
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

  // Platform Administrator is a system role (tenant_id IS NULL), so the
  // check above accepted it — which meant any church admin holding
  // users.manage could grant themselves platform.manage and take control of
  // every tenant on the platform. It is filtered out of listForTenant too,
  // but this endpoint takes a roleId directly: hiding it from a dropdown is
  // not a control. Reported as "not found" rather than "forbidden" so the
  // API doesn't confirm the role's existence to a tenant that must not know
  // about it. Platform admins are provisioned only by
  // scripts/bootstrapPlatformAdmin.js.
  if (role.tenant_id === null && PLATFORM_ONLY_ROLES.includes(role.name)) {
    throw notFound('Role not found');
  }

  // Super Administrator cannot be GRANTED from inside the tenant workspace
  // either — the missing half of assertNotSuperAdministrator.
  //
  // That guard makes a Super Administrator account immutable here: it cannot
  // be disabled and its roles cannot be stripped. Until now nothing stopped
  // this endpoint from creating one. Any holder of users.manage — an
  // assistant given the role for an afternoon, or a stolen session — could
  // therefore grant Super Administrator to an account they control and
  // produce a permanent, un-removable, un-disableable backdoor into the
  // church's books, with no in-product way to undo it. Being able to mint an
  // account you are then forbidden to revoke is strictly worse than not
  // being able to mint it at all.
  //
  // Provisioning the role stays where the other two guards already point:
  // the platform console, and scripts/bootstrapPlatformAdmin.js. Unlike the
  // platform-only case above this reports 403 rather than 404 — the role is
  // legitimately visible to the tenant (it is in listForTenant, and existing
  // holders are shown on the Users page), so pretending it does not exist
  // would just look like a bug.
  if (role.name === SUPER_ADMIN_ROLE) {
    throw forbidden(
      `The ${SUPER_ADMIN_ROLE} role cannot be granted from within a church workspace. Only a Platform Administrator can assign it.`
    );
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

  // The same role-tenancy check assignRole performs, which this endpoint was
  // missing. user_roles carries no tenant_id of its own, so the DELETE is
  // keyed on a user_id this function has already tenant-verified — a foreign
  // roleId could therefore never have removed another church's grant. What
  // it DID do was write a `user.role_removed` audit entry naming a role id
  // that this tenant does not own, for a delete that silently matched
  // nothing. An audit trail that records revocations which never happened is
  // worse than no entry at all, so the id is validated before anything is
  // written.
  const role = await rolesRepository.findById(roleId);
  if (!role || (role.tenant_id !== null && role.tenant_id !== tenantId)) {
    throw notFound('Role not found');
  }

  // Self-lockout guard, the counterpart to disableUser's own check.
  //
  // Removing your own role is the quietest way to lock yourself out of this
  // system: a Super Administrator who drops their Super Administrator role
  // loses users.manage in the same instant, so nothing in the product can
  // ever give it back — recovery requires direct database access. Unlike
  // disabling yourself (which at least fails loudly at the next login),
  // this one leaves you logged in and slowly discovering that every page
  // has become a 403.
  //
  // Removing a role from SOMEONE ELSE is unaffected; this only refuses the
  // self-directed case.
  if (userId === actorUserId) {
    throw forbidden('You cannot remove a role from your own account');
  }

  // Same immutability rule as disableUser: stripping the Super
  // Administrator role is simply a slower way of disabling the account.
  await assertNotSuperAdministrator(userId, 'modified');

  await userRolesRepository.remove(userId, roleId);

  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'user.role_removed',
    entityType: 'users',
    entityId: userId,
    // Name as well as id, matching what role_assigned already records — an
    // auditor reading "role 7 removed" a year later has to go and resolve
    // that id against a roles table that may since have changed.
    before: { roleId, roleName: role.name },
  });

  return { userId, roleId };
}

// The Super Administrator account is IMMUTABLE from inside the tenant
// workspace.
//
// Super Administrator carries the 'ALL' grant, so it is the account that
// holds a church's books together. Any other user with users.manage —
// an assistant, a clerk given the role for one task, a compromised
// session — could otherwise disable it or strip its roles, leaving the
// tenant with nobody able to administer it and no in-product way back.
// Managing that account is the platform owner's job, via /platform.
//
// Checked by ROLE, not by user id: there is no "first user" flag in the
// schema, and a tenant may legitimately have more than one Super
// Administrator. Every one of them is protected.
async function assertNotSuperAdministrator(userId, action) {
  const roleIds = await userRolesRepository.listRoleIdsForUser(userId);
  if (roleIds.length === 0) return;
  const roles = await Promise.all(roleIds.map((roleId) => rolesRepository.findById(roleId)));
  if (roles.some((role) => role?.name === SUPER_ADMIN_ROLE)) {
    throw forbidden(
      `The ${SUPER_ADMIN_ROLE} account cannot be ${action} from within a church workspace. Only a Platform Administrator can manage it.`
    );
  }
}

export async function disableUser(tenantId, userId, actorUserId) {
  if (userId === actorUserId) {
    throw forbidden('You cannot disable your own account');
  }
  // Confirm the target belongs to THIS tenant before the role lookup —
  // listRoleIdsForUser is keyed by user_id alone and is not tenant-scoped,
  // so probing it with a foreign id must not be possible.
  const target = await usersRepository.findById(tenantId, userId);
  if (!target) throw notFound('User not found');
  await assertNotSuperAdministrator(userId, 'disabled');

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

import bcrypt from 'bcryptjs';
import { withTransaction } from '../../config/db.js';
import { AppError, conflict, notFound } from '../../errors/AppError.js';
import { tenantsRepository } from '../tenants/tenants.repository.js';
import { createTenantWithConnection } from '../tenants/tenants.service.js';
import { usersRepository } from '../users/users.repository.js';
import { rolesRepository } from '../roles/roles.repository.js';
import { userRolesRepository } from '../roles/userRoles.repository.js';
import { refreshTokensRepository } from '../auth/refreshTokens.repository.js';
import { contributorsRepository } from '../contributors/contributors.repository.js';
import { contributorRefreshTokensRepository } from '../memberAuth/contributorRefreshTokens.repository.js';
import { isPlatformTenantSlug } from './platformTenant.js';
import { recordAuditLog } from '../audit/auditLog.service.js';

const BCRYPT_COST = 10;

function toPublicTenantRow(row) {
  // admin_email/admin_full_name are the only per-user fields this ever
  // surfaces — never password_hash, which this query (tenants.repository
  // .js#listAllWithAdminSummary) never selects in the first place.
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    baseCurrency: row.base_currency,
    localeDefault: row.locale_default,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    adminUserId: row.admin_user_id ?? null,
    adminEmail: row.admin_email ?? null,
    adminFullName: row.admin_full_name ?? null,
    userCount: Number(row.user_count ?? 0),
  };
}

export async function listTenants() {
  const rows = await tenantsRepository.listAllWithAdminSummary();
  // The internal platform tenant is infrastructure, not a customer church —
  // it never appears in tenant management (platformTenant.js explains why).
  return rows.filter((row) => !isPlatformTenantSlug(row.slug)).map(toPublicTenantRow);
}

export async function getTenantDetail(tenantId) {
  const tenant = await tenantsRepository.findById(tenantId);
  if (!tenant) throw notFound('Tenant not found');
  const users = await usersRepository.findAllByTenant(tenantId);
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    baseCurrency: tenant.base_currency,
    localeDefault: tenant.locale_default,
    status: tenant.status,
    createdAt: tenant.created_at,
    updatedAt: tenant.updated_at,
    // Never password_hash/failed_login_attempts/locked_until — this is the
    // platform admin's read of "who has access to this tenant", not a
    // credentials view.
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      status: u.status,
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
    })),
  };
}

// Platform-admin-triggered tenant creation. Deliberately mirrors
// auth.service.js#registerTenant's exact transaction shape (tenant +
// first admin user + Super Administrator role assignment, one atomic
// unit) since the resulting account must be indistinguishable from a
// self-registered one at login time — but with two differences the brief
// requires: the actor is the platform admin (audited as such), and there
// is NO issueSession()/auto-login — the new tenant admin logs in
// themselves afterward through the normal /login page, on their own time.
export async function createTenant({ churchName, adminFullName, adminEmail, adminPassword }, actorUserId) {
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
        'System roles are not seeded — run the seed script before creating tenants',
        { status: 500 }
      );
    }
    await userRolesRepository.assign(user.id, superAdminRole.id, connection);

    await recordAuditLog(
      {
        tenantId: tenant.id,
        actorUserId,
        action: 'platform.tenant_created',
        entityType: 'tenants',
        entityId: tenant.id,
        after: { name: tenant.name, slug: tenant.slug, adminEmail },
      },
      connection
    );

    return { tenant, adminUser: { id: user.id, email: user.email, fullName: user.full_name } };
  });
}

export async function updateTenant(tenantId, updates, actorUserId) {
  const existing = await tenantsRepository.findById(tenantId);
  if (!existing) throw notFound('Tenant not found');
  if (isPlatformTenantSlug(existing.slug)) {
    throw new AppError('FORBIDDEN', 'The internal platform tenant cannot be suspended or modified', { status: 403 });
  }

  const updated = await tenantsRepository.updateDetails(tenantId, updates);

  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'platform.tenant_updated',
    entityType: 'tenants',
    entityId: tenantId,
    before: { name: existing.name, baseCurrency: existing.base_currency, localeDefault: existing.locale_default },
    after: updates,
  });

  return updated;
}

export async function setTenantStatus(tenantId, status, actorUserId) {
  const existing = await tenantsRepository.findById(tenantId);
  if (!existing) throw notFound('Tenant not found');

  // Suspending the internal platform tenant would lock every platform
  // administrator out of /platform permanently — login refuses a
  // non-active tenant, so there would be no way back in short of direct
  // database access. Refuse it outright rather than let one click brick
  // the console.
  if (isPlatformTenantSlug(existing.slug)) {
    throw new AppError('FORBIDDEN', 'The internal platform tenant cannot be suspended or modified', { status: 403 });
  }

  if (existing.status === status) return existing;

  const updated = await tenantsRepository.updateStatus(tenantId, status);

  // Suspension takes effect NOW, not at each session's next refresh.
  // auth.service.js#refresh and memberAuth.service.js#refresh both also
  // re-check tenant status (so a session can never outlive a suspension
  // even if this step were skipped) — this makes it immediate rather than
  // "within one access-token TTL", by killing the refresh tokens that
  // would otherwise still be sitting valid in a browser. Deliberately does
  // NOT touch anything else: no user/contributor row, no financial record,
  // nothing is deleted — reactivation just lets login succeed again.
  if (status === 'suspended') {
    const [users, contributors] = await Promise.all([
      usersRepository.findAllByTenant(tenantId),
      contributorsRepository.findAllByTenant(tenantId),
    ]);
    await Promise.all([
      ...users.map((u) => refreshTokensRepository.revokeAllForUser(u.id)),
      ...contributors.map((c) => contributorRefreshTokensRepository.revokeAllForContributor(c.id)),
    ]);
  }

  // Suspending a tenant only ever flips this one enum column — every
  // contribution/expense/receipt/user row is untouched, exactly as
  // required ("existing data must NOT be deleted"). auth.service.js#login
  // already refuses to issue a session for a non-active tenant
  // (`tenant.status !== 'active'`), and memberAuth.service.js#login does
  // the same for the member portal — so suspension takes effect
  // immediately for any NEW login. An already-issued access token remains
  // valid only for its own short TTL (env.jwt.accessTokenTtl, 15m
  // default); nothing here forcibly invalidates a token already in a
  // browser's memory mid-session, matching how every other tenant-status
  // check in this codebase already behaves — reactivation simply lets
  // login/refresh succeed again, with all data intact.
  await recordAuditLog({
    tenantId,
    actorUserId,
    action: status === 'active' ? 'platform.tenant_activated' : 'platform.tenant_suspended',
    entityType: 'tenants',
    entityId: tenantId,
    before: { status: existing.status },
    after: { status },
  });

  return updated;
}

function toPublicAdminUser(user) {
  return { id: user.id, email: user.email, fullName: user.full_name, status: user.status };
}

// Platform-admin-triggered edit of a tenant's admin account — name/email
// only. Never accepts or returns a password here; that is exclusively
// resetTenantAdminPassword's job below, kept as a deliberately separate
// action (matches how the rest of this codebase already treats "edit
// profile" and "change password" as two different operations, e.g.
// auth.service.js's resetPassword vs. no combined "update everything"
// endpoint anywhere in this app).
export async function updateTenantAdmin(tenantId, userId, { fullName, email }, actorUserId) {
  const existing = await usersRepository.findById(tenantId, userId);
  if (!existing) throw notFound('Tenant admin user not found');

  if (email !== existing.email) {
    const conflicting = await usersRepository.findByEmail(tenantId, email);
    if (conflicting && conflicting.id !== userId) {
      throw conflict('That email is already used by another user in this tenant');
    }
  }

  const updated = await usersRepository.update(tenantId, userId, { email, full_name: fullName });

  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'platform.tenant_admin_updated',
    entityType: 'users',
    entityId: userId,
    before: { email: existing.email, fullName: existing.full_name },
    after: { email, fullName },
  });

  return toPublicAdminUser(updated);
}

// Sets a new password for a tenant admin, chosen by the platform admin
// (e.g. "the client forgot their password and has no working email
// recovery flow yet" — this codebase's password-reset-by-email flow,
// auth.service.js#requestPasswordReset, has no email delivery wired up;
// see its own comment — so this is the real, working recovery path today).
// Reuses the exact same bcrypt hashing as every other password write in
// this codebase — never a second hashing implementation. Revokes every
// existing refresh token for that user (same as auth.service.js's own
// resetPassword) so a session issued under the OLD password cannot keep
// refreshing indefinitely after a platform-admin-forced reset; the user
// must log in again with the new password at the normal /login page.
export async function resetTenantAdminPassword(tenantId, userId, newPassword, actorUserId) {
  const existing = await usersRepository.findById(tenantId, userId);
  if (!existing) throw notFound('Tenant admin user not found');

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await usersRepository.setPasswordHash(tenantId, userId, passwordHash);
  await refreshTokensRepository.revokeAllForUser(userId);

  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'platform.tenant_admin_password_reset',
    entityType: 'users',
    entityId: userId,
    // Never the password or its hash — audit_logs.repository.js's own
    // redact() would strip a literal `password`/`hash`-named key anyway,
    // but there is nothing password-shaped in this payload to begin with.
    after: { passwordReset: true },
  });

  return { success: true };
}

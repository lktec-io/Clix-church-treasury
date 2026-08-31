import bcrypt from 'bcryptjs';
import { withTransaction } from '../../config/db.js';
import { AppError, conflict, notFound } from '../../errors/AppError.js';
import { tenantsRepository } from '../tenants/tenants.repository.js';
import { createTenantWithConnection } from '../tenants/tenants.service.js';
import { usersRepository } from '../users/users.repository.js';
import { rolesRepository } from '../roles/roles.repository.js';
import { userRolesRepository } from '../roles/userRoles.repository.js';
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
    adminEmail: row.admin_email ?? null,
    adminFullName: row.admin_full_name ?? null,
    userCount: Number(row.user_count ?? 0),
  };
}

export async function listTenants() {
  const rows = await tenantsRepository.listAllWithAdminSummary();
  return rows.map(toPublicTenantRow);
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
  if (existing.status === status) return existing;

  const updated = await tenantsRepository.updateStatus(tenantId, status);

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

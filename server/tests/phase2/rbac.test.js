import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildRealApp } from '../helpers/realApp.js';
import { seedRbacCatalog } from '../../src/db/seeds/seedRbacCatalog.js';
import { rolesRepository } from '../../src/modules/roles/roles.repository.js';
import { uniqueName } from '../helpers/fixtures.js';

beforeEach(async () => {
  await resetDatabase();
  await seedRbacCatalog();
});

async function registerChurch(app) {
  const payload = {
    churchName: uniqueName('Grace Chapel'),
    adminEmail: `${uniqueName('admin')}@example.test`,
    adminPassword: 'CorrectHorseBatteryStaple',
    adminFullName: 'Test Admin',
  };
  const res = await request(app).post('/api/v1/auth/register-tenant').send(payload).expect(201);
  return { tenant: res.body.data.tenant, admin: res.body.data.user, payload };
}

async function login(app, tenantSlug, email, password) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ tenantSlug, email, password })
    .expect(200);
  return res.body.data.accessToken;
}

function extractCookie(res, name) {
  const header = res.headers['set-cookie']?.find((c) => c.startsWith(`${name}=`));
  if (!header) return null;
  return header.split(';')[0].slice(name.length + 1);
}

async function loginFull(app, tenantSlug, email, password) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ tenantSlug, email, password })
    .expect(200);
  return { token: res.body.data.accessToken, refreshCookie: extractCookie(res, 'refreshToken') };
}

// Invites a user, assigns them a role, accepts the invite, and logs them in —
// exercising the real HTTP flow end to end rather than seeding DB rows directly.
async function createLoggedInUserWithRole(app, superAdminToken, tenant, roleName) {
  const email = `${uniqueName('user')}@example.test`;
  const inviteRes = await request(app)
    .post('/api/v1/users')
    .set('Authorization', `Bearer ${superAdminToken}`)
    .send({ email, fullName: `Test ${roleName}` })
    .expect(201);

  const role = await rolesRepository.findSystemRoleByName(roleName);
  await request(app)
    .post(`/api/v1/users/${inviteRes.body.data.user.id}/roles`)
    .set('Authorization', `Bearer ${superAdminToken}`)
    .send({ roleId: role.id })
    .expect(200);

  const newPassword = 'AcceptedInvitePassword1';
  await request(app)
    .post('/api/v1/auth/password-reset/confirm')
    .send({ token: inviteRes.body.data.devInviteToken, newPassword })
    .expect(200);

  const { token, refreshCookie } = await loginFull(app, tenant.slug, email, newPassword);
  return { userId: inviteRes.body.data.user.id, token, refreshCookie, email, password: newPassword };
}

describe('RBAC — permission matrix', () => {
  it('Super Administrator can access every protected resource used in this phase', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);
    const token = await login(app, tenant.slug, payload.adminEmail, payload.adminPassword);

    await request(app).get('/api/v1/accounts').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v1/funds').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v1/users').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v1/audit-logs').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('Viewer can read accounts/funds but cannot create them', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);
    const superAdminToken = await login(app, tenant.slug, payload.adminEmail, payload.adminPassword);
    const { token } = await createLoggedInUserWithRole(app, superAdminToken, tenant, 'Viewer');

    await request(app).get('/api/v1/accounts').set('Authorization', `Bearer ${token}`).expect(200);

    const createRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Should Not Be Created', type: 'cash' })
      .expect(403);
    expect(createRes.body.error.code).toBe('FORBIDDEN');
  });

  it('Auditor can view audit logs but cannot manage funds', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);
    const superAdminToken = await login(app, tenant.slug, payload.adminEmail, payload.adminPassword);
    const { token } = await createLoggedInUserWithRole(app, superAdminToken, tenant, 'Auditor');

    await request(app).get('/api/v1/audit-logs').set('Authorization', `Bearer ${token}`).expect(200);

    const res = await request(app)
      .post('/api/v1/funds')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Should Not Be Created' })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Approver cannot view or manage users (no users.view/users.manage)', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);
    const superAdminToken = await login(app, tenant.slug, payload.adminEmail, payload.adminPassword);
    const { token } = await createLoggedInUserWithRole(app, superAdminToken, tenant, 'Approver');

    await request(app).get('/api/v1/users').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('a user without users.manage cannot assign themselves a more privileged role (privilege escalation blocked)', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);
    const superAdminToken = await login(app, tenant.slug, payload.adminEmail, payload.adminPassword);
    const { token, userId } = await createLoggedInUserWithRole(app, superAdminToken, tenant, 'Treasurer');

    const superAdminRole = await rolesRepository.findSystemRoleByName('Super Administrator');
    const res = await request(app)
      .post(`/api/v1/users/${userId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleId: superAdminRole.id })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('a user cannot disable their own account', async () => {
    const app = buildRealApp();
    const { tenant, payload, admin } = await registerChurch(app);
    const token = await login(app, tenant.slug, payload.adminEmail, payload.adminPassword);

    const res = await request(app)
      .post(`/api/v1/users/${admin.id}/disable`)
      .set('Authorization', `Bearer ${token}`)
      .send()
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('a disabled user cannot log in even with the correct password', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);
    const superAdminToken = await login(app, tenant.slug, payload.adminEmail, payload.adminPassword);
    const { userId, email, password } = await createLoggedInUserWithRole(
      app,
      superAdminToken,
      tenant,
      'Viewer'
    );

    await request(app)
      .post(`/api/v1/users/${userId}/disable`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send()
      .expect(200);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: tenant.slug, email, password })
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it("a disabled user's active sessions are revoked", async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);
    const superAdminToken = await login(app, tenant.slug, payload.adminEmail, payload.adminPassword);
    const { userId, token, refreshCookie } = await createLoggedInUserWithRole(
      app,
      superAdminToken,
      tenant,
      'Viewer'
    );

    // Confirm the session works before disabling.
    await request(app).get('/api/v1/accounts').set('Authorization', `Bearer ${token}`).expect(200);

    await request(app)
      .post(`/api/v1/users/${userId}/disable`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send()
      .expect(200);

    // The already-issued access token is short-lived and stateless, so it
    // remains valid until it expires — disabling doesn't retroactively
    // invalidate it. What must be revoked is the ability to get a *new* one.
    const refreshAttempt = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${refreshCookie}`)
      .expect(401);
    expect(refreshAttempt.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('RBAC — tenant + role isolation combined', () => {
  it('a role created/used in tenant A has no effect on tenant B users', async () => {
    const app = buildRealApp();
    const { tenant: tenantA, payload: payloadA } = await registerChurch(app);
    const { tenant: tenantB, payload: payloadB } = await registerChurch(app);

    const tokenA = await login(app, tenantA.slug, payloadA.adminEmail, payloadA.adminPassword);
    const tokenB = await login(app, tenantB.slug, payloadB.adminEmail, payloadB.adminPassword);

    // Both are independently Super Administrator in their own tenant.
    await request(app).get('/api/v1/users').set('Authorization', `Bearer ${tokenA}`).expect(200);
    await request(app).get('/api/v1/users').set('Authorization', `Bearer ${tokenB}`).expect(200);

    // Tenant A's admin cannot see tenant B's users despite holding the same role name.
    const listA = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(listA.body.data.every((u) => u.tenant_id === tenantA.id)).toBe(true);
  });
});

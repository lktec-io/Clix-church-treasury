import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildRealApp } from '../helpers/realApp.js';
import { seedRbacCatalog } from '../../src/db/seeds/seedRbacCatalog.js';
import { env } from '../../src/config/env.js';
import { uniqueName } from '../helpers/fixtures.js';

function extractCookie(res, name) {
  const header = res.headers['set-cookie']?.find((c) => c.startsWith(`${name}=`));
  if (!header) return null;
  return header.split(';')[0].slice(name.length + 1);
}

beforeEach(async () => {
  await resetDatabase();
  await seedRbacCatalog();
});

async function registerChurch(app, overrides = {}) {
  const payload = {
    churchName: uniqueName('Grace Chapel'),
    adminEmail: `${uniqueName('admin')}@example.test`,
    adminPassword: 'CorrectHorseBatteryStaple',
    adminFullName: 'Test Admin',
    ...overrides,
  };
  const res = await request(app).post('/api/v1/auth/register-tenant').send(payload).expect(201);
  return { ...res.body.data, payload };
}

describe('POST /auth/register-tenant', () => {
  it('creates a tenant and an active Super Administrator admin user', async () => {
    const app = buildRealApp();
    const { tenant, user } = await registerChurch(app);
    expect(tenant.status).toBe('active');
    expect(user.status).toBe('active');
    expect(user.password_hash).toBeUndefined();
  });

  it('rejects a duplicate church name (slug collision)', async () => {
    const app = buildRealApp();
    const churchName = uniqueName('Unity Church');
    await registerChurch(app, { churchName });
    const res = await request(app)
      .post('/api/v1/auth/register-tenant')
      .send({
        churchName,
        adminEmail: `${uniqueName('admin')}@example.test`,
        adminPassword: 'CorrectHorseBatteryStaple',
        adminFullName: 'Another Admin',
      })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects a weak password', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .post('/api/v1/auth/register-tenant')
      .send({
        churchName: uniqueName('Faith Assembly'),
        adminEmail: `${uniqueName('admin')}@example.test`,
        adminPassword: 'short',
        adminFullName: 'Test Admin',
      })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /auth/login', () => {
  it('logs in with correct credentials and sets an httpOnly refresh cookie', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: tenant.slug, email: payload.adminEmail, password: payload.adminPassword })
      .expect(200);

    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.password_hash).toBeUndefined();
    expect(res.body.data.roles).toContain('Super Administrator');

    const setCookie = res.headers['set-cookie'].join(';');
    expect(setCookie).toMatch(/refreshToken=/);
    expect(setCookie.toLowerCase()).toMatch(/httponly/);
  });

  it('rejects an unknown email with the same generic message as a wrong password', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: tenant.slug, email: payload.adminEmail, password: 'wrong-password-here' })
      .expect(401);

    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: tenant.slug, email: 'nobody@example.test', password: 'whatever12345' })
      .expect(401);

    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    expect(wrongPassword.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a login against an unknown tenant slug with the same generic message', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: 'no-such-church', email: 'nobody@example.test', password: 'whatever12345' })
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('locks the account after repeated failed attempts', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);

    for (let i = 0; i < env.login.maxAttempts; i += 1) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ tenantSlug: tenant.slug, email: payload.adminEmail, password: 'wrong-password' })
        .expect(401);
    }

    // Even the correct password is now rejected — account locked, not just rate limited.
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: tenant.slug, email: payload.adminEmail, password: payload.adminPassword })
      .expect(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('POST /auth/refresh and /auth/logout', () => {
  it('rotates the refresh token on each refresh', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: tenant.slug, email: payload.adminEmail, password: payload.adminPassword })
      .expect(200);
    const firstCookie = extractCookie(loginRes, 'refreshToken');

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${firstCookie}`)
      .expect(200);
    expect(refreshRes.body.data.accessToken).toBeTruthy();

    const secondCookie = extractCookie(refreshRes, 'refreshToken');
    expect(secondCookie).toBeTruthy();
    expect(secondCookie).not.toBe(firstCookie);
  });

  it('rejects reuse of an already-rotated refresh token and kills the whole chain', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: tenant.slug, email: payload.adminEmail, password: payload.adminPassword })
      .expect(200);
    const originalToken = extractCookie(loginRes, 'refreshToken');

    // Rotate once (valid).
    const firstRefreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${originalToken}`)
      .expect(200);
    const rotatedToken = extractCookie(firstRefreshRes, 'refreshToken');

    // Replay the original, now-revoked token.
    const reuseRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${originalToken}`)
      .expect(401);
    expect(reuseRes.body.error.code).toBe('UNAUTHENTICATED');

    // The rotated token that replaced it must also now be dead (chain revoked).
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${rotatedToken}`)
      .expect(401);
  });

  it('rejects a refresh with no cookie at all', async () => {
    const app = buildRealApp();
    const res = await request(app).post('/api/v1/auth/refresh').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed refresh token', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refreshToken=not-a-real-token')
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logout revokes the refresh token so it can no longer be used', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: tenant.slug, email: payload.adminEmail, password: payload.adminPassword })
      .expect(200);
    const cookie = extractCookie(loginRes, 'refreshToken');

    await request(app).post('/api/v1/auth/logout').set('Cookie', `refreshToken=${cookie}`).expect(200);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${cookie}`)
      .expect(401);
  });

  it('logout is idempotent for an unknown/absent token', async () => {
    const app = buildRealApp();
    await request(app).post('/api/v1/auth/logout').expect(200);
  });
});

describe('access token verification', () => {
  it('rejects an expired access token', async () => {
    const app = buildRealApp();
    const expiredToken = jwt.sign({ tenantId: 1, roles: [] }, env.jwt.accessSecret, {
      subject: '1',
      expiresIn: -10,
    });
    const res = await request(app)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const app = buildRealApp();
    const forgedToken = jwt.sign({ tenantId: 1, roles: [] }, 'wrong-secret', { subject: '1' });
    const res = await request(app)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${forgedToken}`)
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a request with no Authorization header', async () => {
    const app = buildRealApp();
    const res = await request(app).get('/api/v1/accounts').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('password reset', () => {
  it('completes a reset and revokes existing sessions', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);
    const agent = request.agent(app);

    await agent
      .post('/api/v1/auth/login')
      .send({ tenantSlug: tenant.slug, email: payload.adminEmail, password: payload.adminPassword })
      .expect(200);

    const requestRes = await request(app)
      .post('/api/v1/auth/password-reset/request')
      .send({ tenantSlug: tenant.slug, email: payload.adminEmail })
      .expect(200);
    const devToken = requestRes.body.data.devToken;
    expect(devToken).toBeTruthy();

    await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token: devToken, newPassword: 'ANewStrongerPassword1' })
      .expect(200);

    // Old session's refresh token must now be dead.
    await agent.post('/api/v1/auth/refresh').expect(401);

    // Old password no longer works; new one does.
    await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: tenant.slug, email: payload.adminEmail, password: payload.adminPassword })
      .expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: tenant.slug, email: payload.adminEmail, password: 'ANewStrongerPassword1' })
      .expect(200);
  });

  it('does not reveal whether an email exists', async () => {
    const app = buildRealApp();
    const { tenant } = await registerChurch(app);
    const res = await request(app)
      .post('/api/v1/auth/password-reset/request')
      .send({ tenantSlug: tenant.slug, email: 'nobody-here@example.test' })
      .expect(200);
    expect(res.body.data.requested).toBe(true);
    expect(res.body.data.devToken).toBeUndefined();
  });

  it('rejects an invalid or already-used reset token', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token: 'bogus-token', newPassword: 'ANewStrongerPassword1' })
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

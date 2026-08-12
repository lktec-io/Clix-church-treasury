import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildRealApp } from '../helpers/realApp.js';
import { seedRbacCatalog } from '../../src/db/seeds/seedRbacCatalog.js';
import { uniqueName } from '../helpers/fixtures.js';
import { pool } from '../../src/config/db.js';

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
  return { tenant: res.body.data.tenant, payload };
}

async function login(app, tenantSlug, email, password) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ tenantSlug, email, password })
    .expect(200);
  return res.body.data.accessToken;
}

describe('security middleware', () => {
  it('sends secure headers on every response (helmet)', async () => {
    const app = buildRealApp();
    const res = await request(app).get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('reflects the ACAO header only for an allowed origin', async () => {
    const app = buildRealApp();
    const allowed = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const disallowed = await request(app)
      .get('/health')
      .set('Origin', 'http://evil.example.test')
      .expect(200);
    expect(disallowed.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns 400, not 500, for malformed JSON bodies', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{not valid json')
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects an oversized request body', async () => {
    const app = buildRealApp();
    const bigString = 'a'.repeat(2 * 1024 * 1024); // 2MB > the 1MB limit
    await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: 'x', email: 'x@x.com', password: bigString })
      .expect(413);
  });

  it('never returns password_hash in any user-facing response', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);
    const token = await login(app, tenant.slug, payload.adminEmail, payload.adminPassword);

    const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${token}`).expect(200);
    for (const user of res.body.data) {
      expect(user.password_hash).toBeUndefined();
    }
  });

  it('a mass-assigned status/role field in an invite payload is ignored', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);
    const token = await login(app, tenant.slug, payload.adminEmail, payload.adminPassword);

    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: `${uniqueName('sneaky')}@example.test`,
        fullName: 'Sneaky User',
        status: 'active', // should be ignored — invited users always start as 'invited'
        role: 'Super Administrator', // not a real field this endpoint accepts
      })
      .expect(201);

    expect(res.body.data.user.status).toBe('invited');

    const [roleRows] = await pool.query('SELECT * FROM user_roles WHERE user_id = ?', [
      res.body.data.user.id,
    ]);
    expect(roleRows).toHaveLength(0);
  });

  it('does not leak plaintext password or raw refresh token into the audit log', async () => {
    const app = buildRealApp();
    const { tenant, payload } = await registerChurch(app);

    await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug: tenant.slug, email: payload.adminEmail, password: 'wrong-password' })
      .expect(401);

    const [rows] = await pool.query(
      'SELECT before_state, after_state FROM audit_logs WHERE action = ?',
      ['auth.login_failed']
    );
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('wrong-password');
    expect(serialized).not.toContain(payload.adminPassword);
  });

  it('an unauthenticated request to a protected route never reaches the controller', async () => {
    const app = buildRealApp();
    const res = await request(app).post('/api/v1/accounts').send({ name: 'x', type: 'cash' }).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');

    // No account should have been created despite the well-formed body.
    const [rows] = await pool.query('SELECT COUNT(*) AS count FROM accounts');
    expect(rows[0].count).toBe(0);
  });
});

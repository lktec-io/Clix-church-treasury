import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { buildRealApp } from '../helpers/realApp.js';
import { createTestTenant, createFinancialFixtures, createTestUserWithRole, uniqueName } from '../helpers/fixtures.js';
import { serializeAuditState, auditLogRepository } from '../../src/modules/audit/auditLog.repository.js';
import { rolesRepository } from '../../src/modules/roles/roles.repository.js';
import { seedRbacCatalog } from '../../src/db/seeds/seedRbacCatalog.js';
import { PERMISSIONS } from '../../src/db/seeds/permissionCatalog.js';

beforeEach(async () => {
  await resetDatabase();
});

async function setup(roleName = 'Super Administrator') {
  const tenant = await createTestTenant();
  const fixtures = await createFinancialFixtures(tenant.id);
  const user = await createTestUserWithRole(tenant.id, roleName);
  const app = buildTestApp({ userId: user.id, tenantId: tenant.id });
  return { tenant, ...fixtures, user, app };
}

// --- Unit tests: the actual bug (ER_INVALID_JSON_TEXT / "[object Object]") ---
describe('serializeAuditState — the production crash and its fix', () => {
  it('serializes a plain object to valid JSON text (never "[object Object]")', () => {
    const result = serializeAuditState({ roleId: 5, roleName: 'Treasurer' });
    expect(result).not.toBe('[object Object]');
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ roleId: 5, roleName: 'Treasurer' });
  });

  it('returns null for null (stored as SQL NULL, not the string "null")', () => {
    expect(serializeAuditState(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(serializeAuditState(undefined)).toBeNull();
  });

  it('passes an already-valid JSON string through unchanged (no double-encoding)', () => {
    const alreadyJson = JSON.stringify({ status: 'reversed' });
    expect(serializeAuditState(alreadyJson)).toBe(alreadyJson);
  });

  it('wraps a plain non-JSON string as a valid JSON string value rather than rejecting it', () => {
    const result = serializeAuditState('just a reason string');
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toBe('just a reason string');
  });

  it('handles nested objects', () => {
    const result = serializeAuditState({ a: { b: { c: 1 } }, list: [1, 2, 3] });
    expect(JSON.parse(result)).toEqual({ a: { b: { c: 1 } }, list: [1, 2, 3] });
  });

  it('handles a top-level array', () => {
    const result = serializeAuditState([{ roleId: 1 }, { roleId: 2 }]);
    expect(JSON.parse(result)).toEqual([{ roleId: 1 }, { roleId: 2 }]);
  });

  it('redacts sensitive keys instead of ever writing them to an append-only log', () => {
    const result = JSON.parse(
      serializeAuditState({
        email: 'admin@example.test',
        password: 'hunter2',
        passwordHash: 'abc',
        newPassword: 'x',
        accessToken: 'jwt.here',
        refreshToken: 'raw-token',
        devInviteToken: 'raw-token-2',
        jwtSecret: 'x',
        apiKey: 'x',
      })
    );
    expect(result.email).toBe('admin@example.test'); // non-sensitive fields survive
    expect(result.password).toBe('[REDACTED]');
    expect(result.passwordHash).toBe('[REDACTED]');
    expect(result.newPassword).toBe('[REDACTED]');
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.refreshToken).toBe('[REDACTED]');
    expect(result.devInviteToken).toBe('[REDACTED]');
    expect(result.jwtSecret).toBe('[REDACTED]');
    expect(result.apiKey).toBe('[REDACTED]');
  });

  it('redacts sensitive keys inside nested objects too', () => {
    const result = JSON.parse(serializeAuditState({ user: { id: 1, password_hash: 'abc' } }));
    expect(result.user.id).toBe(1);
    expect(result.user.password_hash).toBe('[REDACTED]');
  });
});

// --- Integration tests: the exact three production-crashing actions ---
describe('audit logging no longer crashes financial_period.reopened / user.role_assigned / user.role_removed', () => {
  it('reopening a closed financial period succeeds and writes valid JSON audit state', async () => {
    const ctx = await setup();
    await request(ctx.app).post(`/api/v1/financial-periods/${ctx.period.id}/close`).expect(200);

    await request(ctx.app)
      .post(`/api/v1/financial-periods/${ctx.period.id}/reopen`)
      .send({ reason: 'Found an unrecorded contribution' })
      .expect(200);

    const logs = await auditLogRepository.listForTenant(ctx.tenant.id, { limit: 10 });
    const entry = logs.find((l) => l.action === 'financial_period.reopened');
    expect(entry).toBeTruthy();
    expect(entry.after_state).toEqual({ reason: 'Found an unrecorded contribution' });
  });

  it('assigning a role succeeds and writes valid JSON audit state', async () => {
    const ctx = await setup();
    const target = await createTestUserWithRole(ctx.tenant.id, 'Viewer');
    const treasurerRole = await rolesRepository.findSystemRoleByName('Treasurer');

    await request(ctx.app).post(`/api/v1/users/${target.id}/roles`).send({ roleId: treasurerRole.id }).expect(200);

    const logs = await auditLogRepository.listForTenant(ctx.tenant.id, { limit: 10 });
    const entry = logs.find((l) => l.action === 'user.role_assigned');
    expect(entry).toBeTruthy();
    expect(entry.after_state).toEqual({ roleId: treasurerRole.id, roleName: 'Treasurer' });
  });

  it('removing a role succeeds and writes valid JSON audit state', async () => {
    const ctx = await setup();
    const target = await createTestUserWithRole(ctx.tenant.id, 'Viewer');
    const viewerRole = await rolesRepository.findSystemRoleByName('Viewer');

    await request(ctx.app).delete(`/api/v1/users/${target.id}/roles/${viewerRole.id}`).expect(200);

    const logs = await auditLogRepository.listForTenant(ctx.tenant.id, { limit: 10 });
    const entry = logs.find((l) => l.action === 'user.role_removed');
    expect(entry).toBeTruthy();
    expect(entry.before_state).toEqual({ roleId: viewerRole.id });
  });
});

// --- The first registered administrator must actually have every permission ---
describe('Super Administrator provisioning via the real registration endpoint', () => {
  it('a newly registered church admin has the full permission catalog immediately, via the exact production code path', async () => {
    await seedRbacCatalog();
    const app = buildRealApp();

    const payload = {
      churchName: uniqueName('Hope Chapel'),
      adminEmail: `${uniqueName('admin')}@example.test`,
      adminPassword: 'CorrectHorseBatteryStaple',
      adminFullName: 'Test Admin',
    };
    const registerRes = await request(app).post('/api/v1/auth/register-tenant').send(payload).expect(201);
    const { slug: tenantSlug } = registerRes.body.data.tenant;

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ tenantSlug, email: payload.adminEmail, password: payload.adminPassword })
      .expect(200);

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`)
      .expect(200);

    expect(meRes.body.data.roles).toContain('Super Administrator');
    expect(meRes.body.data.permissions).toHaveLength(PERMISSIONS.length);
    // Spot-check permissions added across later phases — a regression that
    // only broke, say, Phase 8's additions would still pass a naive
    // "non-empty permissions" check but not this.
    expect(meRes.body.data.permissions).toEqual(expect.arrayContaining([
      'financial_period.reopen',
      'users.manage',
      'reports.export',
      'audit.view',
    ]));
  });
});

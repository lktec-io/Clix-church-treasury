import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildTestApp } from '../helpers/testApp.js';
import { createTestTenant, createTestUserWithRole, createTestContributor } from '../helpers/fixtures.js';
import { smsLogRepository } from '../../src/modules/sms/smsLog.repository.js';

beforeEach(async () => {
  await resetDatabase();
});

async function setup(roleName = 'Treasurer') {
  const tenant = await createTestTenant();
  const user = await createTestUserWithRole(tenant.id, roleName);
  const app = buildTestApp({ userId: user.id, tenantId: tenant.id });
  return { tenant, user, app };
}

describe('POST /contributors/:id/portal-access', () => {
  it('allocates a member number, generates a PIN, and records a skipped-no-provider SMS attempt', async () => {
    const ctx = await setup();
    const contributor = await createTestContributor(ctx.tenant.id, { phone: '+255700000000' });

    const res = await request(ctx.app).post(`/api/v1/contributors/${contributor.id}/portal-access`).expect(200);
    expect(res.body.data.contributor.member_number).toMatch(/^M\d{4}$/);
    expect(res.body.data.contributor.pin_hash).toBeUndefined();
    // No BEEM_API_KEY is configured in the test environment, so the
    // provider always resolves to noop — this is the honest, non-fabricated
    // outcome, not a test-only shortcut (server/src/config/env.js).
    expect(res.body.data.sms.status).toBe('skipped_no_provider');

    const logs = await smsLogRepository.findAllByTenant(ctx.tenant.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].template_key).toBe('member_registration');
    expect(logs[0].body).not.toContain('{{'); // every placeholder was substituted
  });

  it('rejects enabling portal access twice for the same contributor', async () => {
    const ctx = await setup();
    const contributor = await createTestContributor(ctx.tenant.id, { phone: '+255700000000' });
    await request(ctx.app).post(`/api/v1/contributors/${contributor.id}/portal-access`).expect(200);
    const res = await request(ctx.app).post(`/api/v1/contributors/${contributor.id}/portal-access`).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('requires a phone number on file', async () => {
    const ctx = await setup();
    const contributor = await createTestContributor(ctx.tenant.id);
    const res = await request(ctx.app).post(`/api/v1/contributors/${contributor.id}/portal-access`).expect(422);
    expect(res.body.error.fields.phone).toBeTruthy();
  });

  it('a role without contributors.manage is forbidden', async () => {
    const ctx = await setup('Viewer');
    const contributor = await createTestContributor(ctx.tenant.id, { phone: '+255700000000' });
    await request(ctx.app).post(`/api/v1/contributors/${contributor.id}/portal-access`).expect(403);
  });
});

describe('POST /contributors/:id/portal-access/reset-pin', () => {
  it('resets the PIN and logs another SMS attempt', async () => {
    const ctx = await setup();
    const contributor = await createTestContributor(ctx.tenant.id, { phone: '+255700000000' });
    await request(ctx.app).post(`/api/v1/contributors/${contributor.id}/portal-access`).expect(200);

    await request(ctx.app).post(`/api/v1/contributors/${contributor.id}/portal-access/reset-pin`).expect(200);
    const logs = await smsLogRepository.findAllByTenant(ctx.tenant.id);
    expect(logs).toHaveLength(2);
  });

  it('rejects resetting a PIN for a contributor whose portal was never enabled', async () => {
    const ctx = await setup();
    const contributor = await createTestContributor(ctx.tenant.id, { phone: '+255700000000' });
    const res = await request(ctx.app)
      .post(`/api/v1/contributors/${contributor.id}/portal-access/reset-pin`)
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

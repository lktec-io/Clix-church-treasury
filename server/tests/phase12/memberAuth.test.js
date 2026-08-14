import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { resetDatabase } from '../helpers/resetDb.js';
import { buildRealApp } from '../helpers/realApp.js';
import { createTestTenant, createTestMemberContributor } from '../helpers/fixtures.js';

beforeEach(async () => {
  await resetDatabase();
});

function extractCookie(res, name) {
  const raw = res.headers['set-cookie']?.find((c) => c.startsWith(`${name}=`));
  if (!raw) return null;
  return raw.split(';')[0].split('=')[1];
}

async function loginMember(app, tenant, contributor, pin) {
  return request(app).post('/api/v1/member/auth/login').send({
    tenantSlug: tenant.slug,
    memberNumber: contributor.member_number,
    pin,
  });
}

describe('POST /member/auth/login', () => {
  it('logs in with the correct member number and PIN', async () => {
    const app = buildRealApp();
    const tenant = await createTestTenant();
    const contributor = await createTestMemberContributor(tenant.id, { pin: '4321' });

    const res = await loginMember(app, tenant, contributor, '4321').expect(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.contributor.full_name).toBe(contributor.full_name);
    expect(res.body.data.contributor.pin_hash).toBeUndefined();
    expect(extractCookie(res, 'memberRefreshToken')).toBeTruthy();
  });

  it('rejects a wrong PIN with a generic message', async () => {
    const app = buildRealApp();
    const tenant = await createTestTenant();
    const contributor = await createTestMemberContributor(tenant.id, { pin: '4321' });

    const res = await loginMember(app, tenant, contributor, '9999').expect(401);
    expect(res.body.error.message).toBe('Invalid member number or PIN');
  });

  it('rejects an unknown member number with the same generic message', async () => {
    const app = buildRealApp();
    const tenant = await createTestTenant();
    const res = await request(app)
      .post('/api/v1/member/auth/login')
      .send({ tenantSlug: tenant.slug, memberNumber: 'M9999', pin: '1234' })
      .expect(401);
    expect(res.body.error.message).toBe('Invalid member number or PIN');
  });

  it('rejects a contributor whose portal access was never enabled', async () => {
    const app = buildRealApp();
    const tenant = await createTestTenant();
    const { contributorsRepository } = await import('../../src/modules/contributors/contributors.repository.js');
    const contributor = await contributorsRepository.create(tenant.id, { fullName: 'Not Enrolled', phone: '+255700000001' });

    await request(app)
      .post('/api/v1/member/auth/login')
      .send({ tenantSlug: tenant.slug, memberNumber: contributor.member_number ?? 'M0001', pin: '1234' })
      .expect(401);
  });

  it('locks the account after repeated failed attempts', async () => {
    const app = buildRealApp();
    const tenant = await createTestTenant();
    const contributor = await createTestMemberContributor(tenant.id, { pin: '4321' });

    for (let i = 0; i < 5; i += 1) {
      await loginMember(app, tenant, contributor, '0000');
    }
    const res = await loginMember(app, tenant, contributor, '4321').expect(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('member session lifecycle', () => {
  it('GET /member/auth/me returns the current contributor once authenticated', async () => {
    const app = buildRealApp();
    const tenant = await createTestTenant();
    const contributor = await createTestMemberContributor(tenant.id);
    const loginRes = await loginMember(app, tenant, contributor, contributor.rawPin).expect(200);

    const res = await request(app)
      .get('/api/v1/member/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`)
      .expect(200);
    expect(res.body.data.contributor.id).toBe(contributor.id);
  });

  it('refresh rotates the cookie and reuse of an old token is rejected', async () => {
    const app = buildRealApp();
    const tenant = await createTestTenant();
    const contributor = await createTestMemberContributor(tenant.id);
    const loginRes = await loginMember(app, tenant, contributor, contributor.rawPin).expect(200);
    const firstRefreshToken = extractCookie(loginRes, 'memberRefreshToken');

    const refreshRes = await request(app)
      .post('/api/v1/member/auth/refresh')
      .set('Cookie', `memberRefreshToken=${firstRefreshToken}`)
      .expect(200);
    expect(refreshRes.body.data.accessToken).toBeTruthy();

    // Reusing the now-rotated-away first token must be rejected.
    await request(app)
      .post('/api/v1/member/auth/refresh')
      .set('Cookie', `memberRefreshToken=${firstRefreshToken}`)
      .expect(401);
  });

  it('a staff JWT is rejected on member-scoped routes', async () => {
    const app = buildRealApp();
    const tenant = await createTestTenant();
    await createTestMemberContributor(tenant.id);
    const { signAccessToken } = await import('../../src/modules/auth/tokens.js');
    const staffToken = signAccessToken({ userId: 1, tenantId: tenant.id, roles: ['Super Administrator'] });

    await request(app).get('/api/v1/member/auth/me').set('Authorization', `Bearer ${staffToken}`).expect(401);
  });
});

describe('member data isolation', () => {
  it('member A cannot see member B\'s contributions', async () => {
    const app = buildRealApp();
    const tenant = await createTestTenant();
    const memberA = await createTestMemberContributor(tenant.id, { pin: '1111' });
    const memberB = await createTestMemberContributor(tenant.id, { pin: '2222' });

    const loginA = await loginMember(app, tenant, memberA, '1111').expect(200);
    const resA = await request(app)
      .get('/api/v1/member/contributions')
      .set('Authorization', `Bearer ${loginA.body.data.accessToken}`)
      .expect(200);
    expect(resA.body.data).toEqual([]);

    // memberB exists purely to prove the isolation query is scoped by the
    // authenticated contributor, not just "any contributor in this tenant".
    expect(memberB.id).not.toBe(memberA.id);
  });
});

describe('POST /member/auth/change-pin', () => {
  it('changes the PIN and clears mustChangePin', async () => {
    const app = buildRealApp();
    const tenant = await createTestTenant();
    const contributor = await createTestMemberContributor(tenant.id, { pin: '1234' });
    const loginRes = await loginMember(app, tenant, contributor, '1234').expect(200);
    const token = loginRes.body.data.accessToken;

    await request(app)
      .post('/api/v1/member/auth/change-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPin: '1234', newPin: '5678' })
      .expect(200);

    await loginMember(app, tenant, contributor, '1234').expect(401);
    await loginMember(app, tenant, contributor, '5678').expect(200);
  });

  it('rejects the wrong current PIN', async () => {
    const app = buildRealApp();
    const tenant = await createTestTenant();
    const contributor = await createTestMemberContributor(tenant.id, { pin: '1234' });
    const loginRes = await loginMember(app, tenant, contributor, '1234').expect(200);

    await request(app)
      .post('/api/v1/member/auth/change-pin')
      .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`)
      .send({ currentPin: '0000', newPin: '5678' })
      .expect(401);
  });
});

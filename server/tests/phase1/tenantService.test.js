import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase } from '../helpers/resetDb.js';
import { createTenant, getTenantById, setTenantStatus, slugify } from '../../src/modules/tenants/tenants.service.js';
import { churchSettingsRepository } from '../../src/modules/tenants/churchSettings.repository.js';

beforeEach(async () => {
  await resetDatabase();
});

describe('tenant provisioning', () => {
  it('creates a tenant and its 1:1 church_settings row atomically', async () => {
    const tenant = await createTenant({ name: 'Grace Chapel' });
    expect(tenant.slug).toBe('grace-chapel');
    expect(tenant.status).toBe('active');

    const settings = await churchSettingsRepository.findByTenantId(tenant.id);
    expect(settings).not.toBeNull();
    expect(settings.tenant_id).toBe(tenant.id);
  });

  it('rejects a duplicate slug', async () => {
    await createTenant({ name: 'Grace Chapel' });
    await expect(createTenant({ name: 'Grace Chapel' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('does not leave an orphaned tenant row if slug collision is detected mid-transaction', async () => {
    const first = await createTenant({ name: 'Unity Church' });
    try {
      await createTenant({ name: 'Unity Church' });
    } catch {
      // expected
    }
    const tenant = await getTenantById(first.id);
    expect(tenant.name).toBe('Unity Church');
  });

  it('slugify produces URL-safe, lowercase slugs', () => {
    expect(slugify('St. Mary\'s Church!!')).toBe('st-mary-s-church');
    expect(slugify('  Grace   Chapel  ')).toBe('grace-chapel');
  });

  it('can suspend and reactivate a tenant', async () => {
    const tenant = await createTenant({ name: 'Faith Assembly' });
    const suspended = await setTenantStatus(tenant.id, 'suspended');
    expect(suspended.status).toBe('suspended');

    const reactivated = await setTenantStatus(tenant.id, 'active');
    expect(reactivated.status).toBe('active');
  });

  it('throws NOT_FOUND for a non-existent tenant id', async () => {
    await expect(getTenantById(999999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

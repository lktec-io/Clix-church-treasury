import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase } from '../helpers/resetDb.js';
import { createTestTenant } from '../helpers/fixtures.js';
import { sendSms } from '../../src/modules/sms/sms.service.js';
import { renderTemplate } from '../../src/modules/sms/smsTemplates.js';
import { smsLogRepository } from '../../src/modules/sms/smsLog.repository.js';

beforeEach(async () => {
  await resetDatabase();
});

describe('smsTemplates#renderTemplate', () => {
  it('substitutes every placeholder and leaves none behind', () => {
    const body = renderTemplate('contribution_confirmation', 'en', {
      churchName: 'Mwamoto SDA Church',
      memberName: 'Debora',
      amount: 'TZS 10,000.00',
      date: '2026-07-15',
      reference: 'RCT-2026-0001',
    });
    expect(body).not.toContain('{{');
    expect(body).toContain('Debora');
    expect(body).toContain('TZS 10,000.00');
  });

  it('falls back to English for an unsupported locale', () => {
    const en = renderTemplate('contribution_confirmation', 'en', { memberName: 'X' });
    const fr = renderTemplate('contribution_confirmation', 'fr', { memberName: 'X' });
    expect(fr).toBe(en);
  });

  it('renders Swahili with no leftover placeholders', () => {
    const body = renderTemplate('monthly_statement', 'sw', {
      churchName: 'Kanisa',
      memberName: 'Debora',
      month: '07-2026',
      tithe: '0.00',
      offering: '0.00',
      other: '10,000.00',
      total: '10,000.00',
    });
    expect(body).not.toContain('{{');
    expect(body).toContain('Zaka');
    expect(body).toContain('Sadaka');
  });
});

describe('sms.service#sendSms', () => {
  it('never throws even with an unconfigured provider, and always writes an sms_log row', async () => {
    const tenant = await createTestTenant();
    const result = await sendSms(tenant.id, {
      phone: '+255700000000',
      templateKey: 'member_registration',
      locale: 'en',
      params: { churchName: 'Test Church', memberName: 'Test Member', memberNumber: 'M0001', pin: '1234' },
    });
    expect(result.status).toBe('skipped_no_provider');

    const logs = await smsLogRepository.findAllByTenant(tenant.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('skipped_no_provider');
    expect(logs[0].body).toContain('Test Member');
  });
});

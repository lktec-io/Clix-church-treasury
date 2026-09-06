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
      // currency and amount are SEPARATE params — amount must be bare, or
      // the template's own {{currency}} produces "TZS TZS 10,000.00".
      currency: 'TZS',
      amount: '10,000.00',
      date: '2026-07-15',
      reference: 'RCT-2026-0001',
    });
    expect(body).not.toContain('{{');
    expect(body).toContain('Debora');
    expect(body).toContain('TZS 10,000.00');
    expect(body).not.toContain('TZS TZS');
  });

  // SMS is Swahili-only. The locale argument is accepted for call-site
  // compatibility and ignored, so NO value — including an explicit 'en', a
  // stale contributors.locale row, or a typo — can produce English.
  it('renders Swahili for every locale value, including an explicit "en"', () => {
    const sw = renderTemplate('contribution_confirmation', 'sw', { memberName: 'X' });
    for (const locale of ['en', 'fr', '', null, undefined]) {
      expect(renderTemplate('contribution_confirmation', locale, { memberName: 'X' })).toBe(sw);
    }
    expect(sw).toContain('Tunakushukuru');
    expect(sw).toContain('Mungu akubariki sana.');
  });

  it('renders Swahili with no leftover placeholders', () => {
    // The statement now carries a dynamic {{lines}} block (one row per fund)
    // instead of fixed tithe/offering/other slots — see
    // phase16/smsSwahiliTemplates.test.js for the full wording assertions.
    const body = renderTemplate('monthly_statement', 'sw', {
      churchName: 'Kanisa',
      memberName: 'Debora',
      month: 'Julai 2026',
      currency: 'TZS',
      lines: '- Zaka: TZS 10,000.00',
      total: '10,000.00',
    });
    expect(body).not.toContain('{{');
    expect(body).toContain('Zaka');
    expect(body).toContain('Jumla Kuu');
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

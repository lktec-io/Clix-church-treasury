import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Separate file (own module-level mock) rather than reusing
// beemProvider.test.js's mock, specifically to reproduce the production
// configuration reported in the live incident: BEEM_SENDER_ID="Clix
// Notify" (with a space) producing a 403 from Beem. GSM alphanumeric
// sender IDs are conventionally letters/digits only; a space is a
// concrete, checkable reason a 403 ("credentials valid, request denied")
// could be about the sender ID rather than the API key/secret.
vi.mock('../../src/config/env.js', () => ({
  env: {
    sms: {
      beem: {
        apiKey: 'test-api-key-123',
        secretKey: 'test-secret-key-456',
        senderId: 'Clix Notify',
        apiUrl: 'https://apisms.beem.africa/v1/send',
      },
    },
  },
}));

const { sendViaBeem } = await import('../../src/modules/sms/providers/beemProvider.js');

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

describe('sendViaBeem — sender ID with a space (production incident configuration)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { message: 'Forbidden' })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('still sends the sender ID exactly as configured, unmodified, in source_addr', async () => {
    await sendViaBeem({ phone: '255712345678', body: 'x' });
    const [, options] = fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.source_addr).toBe('Clix Notify');
  });

  it('surfaces a sender-ID-format hint in the error message on a 403 with this exact configuration', async () => {
    const result = await sendViaBeem({ phone: '255712345678', body: 'x' });
    expect(result.reasonCode).toBe('forbidden');
    expect(result.errorMessage).toContain('sender ID');
    expect(result.errorMessage).toContain('space');
  });
});

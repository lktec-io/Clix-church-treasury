import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks the config module beemProvider.js imports so each test controls
// apiKey/secretKey/senderId/apiUrl directly, without touching real
// process.env or the real server/.env file — this is what actually lets
// the adapter's request-building and response-classification logic be
// proven in isolation, with zero network access and zero real credentials
// (backend stabilization Phase 20: "MOCK external Beem requests in
// automated tests. Do NOT put real secrets into tests.").
vi.mock('../../src/config/env.js', () => ({
  env: {
    sms: {
      beem: {
        apiKey: 'test-api-key-123',
        secretKey: 'test-secret-key-456',
        senderId: 'CLIX',
        apiUrl: 'https://apisms.beem.africa/v1/send',
      },
    },
  },
}));

const { sendViaBeem } = await import('../../src/modules/sms/providers/beemProvider.js');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe('sendViaBeem — request construction', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { successful: true, request_id: 999 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the configured apiUrl with a Basic-Auth header built from apiKey:secretKey', async () => {
    await sendViaBeem({ phone: '255712345678', body: 'hello' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://apisms.beem.africa/v1/send');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');

    const expectedAuth = `Basic ${Buffer.from('test-api-key-123:test-secret-key-456').toString('base64')}`;
    expect(options.headers.Authorization).toBe(expectedAuth);
    // The raw key/secret must never appear verbatim anywhere in the
    // outgoing request other than inside the base64 Authorization value —
    // no accidental second copy in a query string, body field, etc.
    expect(JSON.stringify(options)).not.toContain('test-api-key-123');
  });

  it('sends the recipient/sender/message in the documented Beem request-body shape', async () => {
    await sendViaBeem({ phone: '255712345678', body: 'Asante kwa mchango wako' });

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      source_addr: 'CLIX',
      encoding: 0,
      message: 'Asante kwa mchango wako',
      recipients: [{ recipient_id: 1, dest_addr: '255712345678' }],
    });
  });
});

describe('sendViaBeem — response classification', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('classifies a 200 with successful:true as sent, capturing the provider message id', async () => {
    fetch.mockResolvedValue(jsonResponse(200, { successful: true, request_id: 42 }));
    const result = await sendViaBeem({ phone: '255712345678', body: 'x' });
    expect(result).toEqual({ status: 'sent', providerMessageId: '42' });
  });

  it('classifies a 401 as reasonCode "auth" (the exact status this incident is about)', async () => {
    fetch.mockResolvedValue(jsonResponse(401, { message: 'Invalid Authentication Parameters' }));
    const result = await sendViaBeem({ phone: '255712345678', body: 'x' });
    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('auth');
    expect(result.errorMessage).toContain('401');
    expect(result.errorMessage).toContain('Invalid Authentication Parameters');
  });

  it('classifies a 403 as reasonCode "forbidden" — distinct from 401 "auth", since a 403 means the credentials were recognized but the specific request (usually the sender ID) was denied', async () => {
    fetch.mockResolvedValue(jsonResponse(403, { message: 'Forbidden' }));
    const result = await sendViaBeem({ phone: '255712345678', body: 'x' });
    expect(result.reasonCode).toBe('forbidden');
    expect(result.reasonCode).not.toBe('auth');
  });


  it('classifies a 400 as reasonCode "bad_request"', async () => {
    fetch.mockResolvedValue(jsonResponse(400, { message: 'Invalid sender id' }));
    const result = await sendViaBeem({ phone: '255712345678', body: 'x' });
    expect(result.reasonCode).toBe('bad_request');
  });

  it('classifies a 429 as reasonCode "rate_limited"', async () => {
    fetch.mockResolvedValue(jsonResponse(429, { message: 'Too many requests' }));
    const result = await sendViaBeem({ phone: '255712345678', body: 'x' });
    expect(result.reasonCode).toBe('rate_limited');
  });

  it('classifies a 500 as reasonCode "provider_error"', async () => {
    fetch.mockResolvedValue(jsonResponse(500, { message: 'Internal error' }));
    const result = await sendViaBeem({ phone: '255712345678', body: 'x' });
    expect(result.reasonCode).toBe('provider_error');
  });

  it('classifies a 200 response with successful:false (Beem-level rejection, not HTTP-level) as provider_rejected', async () => {
    fetch.mockResolvedValue(jsonResponse(200, { successful: false, message: 'Rejected by carrier' }));
    const result = await sendViaBeem({ phone: '255712345678', body: 'x' });
    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('provider_rejected');
  });

  it('classifies a network-level fetch rejection as reasonCode "network"', async () => {
    fetch.mockRejectedValue(new TypeError('fetch failed: ENOTFOUND apisms.beem.africa'));
    const result = await sendViaBeem({ phone: '255712345678', body: 'x' });
    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('network');
  });

  it('classifies an AbortSignal timeout rejection as reasonCode "timeout", distinct from a generic network failure', async () => {
    const timeoutError = new DOMException('The operation timed out.', 'TimeoutError');
    fetch.mockRejectedValue(timeoutError);
    const result = await sendViaBeem({ phone: '255712345678', body: 'x' });
    expect(result.status).toBe('failed');
    expect(result.reasonCode).toBe('timeout');
  });

  it('classifies an unparseable (non-JSON) response body as a failure rather than throwing', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>502 Bad Gateway</html>',
    });
    const result = await sendViaBeem({ phone: '255712345678', body: 'x' });
    expect(result.status).toBe('failed');
  });
});

import { env } from '../../../config/env.js';

// Beem Africa's single-SMS-send REST endpoint, per their publicly
// documented API contract (Basic Auth of apiKey:secretKey, JSON body with
// a `recipients` array). Only ever called when env.sms.provider === 'beem'
// (i.e. BEEM_API_KEY and BEEM_SECRET_KEY are both set — see
// server/src/config/env.js), which is not the case in this environment.
//
// IMPORTANT — not exercised against a live Beem account from this
// environment (no credentials, no network access to a paid SMS gateway):
// verify `apiUrl`, the request/response shape, and the `sender_id`
// requirements against Beem's current developer dashboard/docs before
// relying on this in production, and check delivery with a real test
// message first. Uses Node's built-in `fetch` — no new dependency.
const REQUEST_TIMEOUT_MS = 10_000;

export async function sendViaBeem({ phone, body }) {
  const { apiKey, secretKey, senderId, apiUrl } = env.sms.beem;
  const auth = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');

  let response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_addr: senderId,
        schedule_time: '',
        encoding: 0,
        message: body,
        recipients: [{ recipient_id: 1, dest_addr: phone }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Network failure, DNS failure, or the timeout above firing — never a
    // thrown error the caller has to handle specially (sms.service.js's own
    // try/catch would also catch this, but resolving to the same shape here
    // keeps every non-2xx/network outcome uniform for the caller).
    return { status: 'failed', errorMessage: `Could not reach Beem API: ${error.message}` };
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload || payload.successful !== true) {
    return {
      status: 'failed',
      errorMessage: payload?.message ?? `Beem API returned HTTP ${response.status}`,
    };
  }

  return { status: 'sent', providerMessageId: payload.request_id ? String(payload.request_id) : null };
}

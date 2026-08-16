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

// Classifies an HTTP status from Beem into a stable, non-secret reason
// code — so a caller (SMS status UI, PM2 logs) can distinguish "your
// credentials are wrong" from "you sent a malformed request" from "you're
// being rate limited" without parsing free-text prose (client requirement:
// "improve SMS errors so they distinguish invalid credentials / invalid
// sender / invalid phone number / provider rejection / timeout / network
// failure / rate limit").
function classifyHttpFailure(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'bad_request';
  if (status >= 500) return 'provider_error';
  return 'provider_rejected';
}

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
    // AbortSignal.timeout() rejects with a DOMException named
    // "TimeoutError" — distinguished from a genuine network/DNS failure
    // (anything else fetch can throw) so "Beem is slow" and "Beem is
    // unreachable" don't get reported identically.
    const reasonCode = error.name === 'TimeoutError' ? 'timeout' : 'network';
    const errorMessage =
      reasonCode === 'timeout'
        ? `Beem API did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`
        : `Could not reach Beem API: ${error.message}`;
    return { status: 'failed', reasonCode, errorMessage };
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload || payload.successful !== true) {
    // Both the HTTP status and Beem's own message text, when Beem sends
    // one — a bare "Invalid Authentication Parameters" alone doesn't tell
    // an operator whether that was a 401 (credentials wrong/expired) or a
    // 400 (malformed request, e.g. bad sender ID or phone format) — the
    // status code narrows that down without exposing the credentials
    // themselves. `reasonCode` gives a caller a stable value to branch on
    // instead of parsing this text.
    const reasonCode = classifyHttpFailure(response.status);
    const detail = payload?.message ? `HTTP ${response.status} — ${payload.message}` : `HTTP ${response.status}`;
    return { status: 'failed', reasonCode, errorMessage: `Beem API: ${detail}` };
  }

  return { status: 'sent', providerMessageId: payload.request_id ? String(payload.request_id) : null };
}

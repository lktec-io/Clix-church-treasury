import { env } from '../../../config/env.js';
import { normalizeSenderId, senderIdWarning } from '../senderId.js';

// Beem Africa's single-SMS-send REST endpoint, per their publicly
// documented API contract (Basic Auth of apiKey:secretKey, JSON body with
// a `recipients` array). Only ever called when env.sms.provider === 'beem'
// (i.e. BEEM_API_KEY and BEEM_SECRET_KEY are both set — see
// server/src/config/env.js).
const REQUEST_TIMEOUT_MS = 10_000;

// senderIdWarning/normalizeSenderId now live in ../senderId.js so config
// (env.js) and this payload builder cannot drift on what a valid sender ID
// is — they were one copy of the rule each, which is how the two ended up
// able to disagree.

// Classifies an HTTP status from Beem into a stable, non-secret reason
// code — so a caller (SMS status UI, PM2 logs) can distinguish "your
// credentials are wrong" from "you sent a malformed request" from "you're
// being rate limited" without parsing free-text prose. 401 and 403 are
// deliberately DIFFERENT codes, not collapsed into one "auth" bucket:
// 401 (Unauthorized) means the key/secret pair itself is rejected; 403
// (Forbidden) means Beem recognized the credentials but denied the
// specific request — in practice this is overwhelmingly an unapproved or
// mismatched sender ID, not a bad key/secret. Treating them identically
// was actively misleading an operator toward re-checking credentials that
// were never the problem.
function classifyHttpFailure(status) {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'bad_request';
  if (status >= 500) return 'provider_error';
  return 'provider_rejected';
}

// SHA-256 fingerprint of a credential — cheap, safe way to prove "the
// value the running process actually has in memory right now" is the one
// intended, without ever printing or transmitting the value itself. Two
// deployments/processes with the same credential produce the same
// fingerprint; a stale/wrong value produces a different one instantly
// visible in a diff of two log lines.
async function sha256Fingerprint(value) {
  if (!value) return null;
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

function maskPhone(phone) {
  if (!phone || phone.length < 4) return '***';
  return `${'*'.repeat(Math.max(phone.length - 4, 0))}${phone.slice(-4)}`;
}

export async function sendViaBeem({ phone, body }) {
  const { apiKey, secretKey, apiUrl } = env.sms.beem;
  // Re-normalised at payload time as well as at config time. env.js already
  // cleans it, but this is the last line before the value goes on the wire
  // and the cost is a string compare — a future caller that constructs a
  // config by hand (a test, a script) cannot bypass the rule this way.
  const senderId = normalizeSenderId(env.sms.beem.senderId);
  const auth = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');
  const warning = senderIdWarning(senderId);

  // An empty sender ID is refused HERE rather than posted. Beem rejects the
  // request anyway, but as a generic 4xx that reads like a credential
  // problem — and every such attempt burns a network round trip and writes
  // a misleading sms_log row. Failing locally gives the operator the actual
  // cause. Returned as a normal failure result (never thrown), so the
  // member-portal callers — enablePortalAccess and resetPin — carry on and
  // still commit their transaction: sendSms() is explicitly not allowed to
  // affect the outcome of the operation that triggered it.
  if (!senderId) {
    const errorMessage =
      'BEEM_SENDER_ID is not set, so there is no approved sender to send as. Set it in server/.env to the ' +
      'sender ID approved in the Beem dashboard.';
    console.log(`[beem] refusing to send: reason=config_invalid error="${errorMessage}"`);
    return { status: 'failed', reasonCode: 'config_invalid', errorMessage };
  }

  // Forensic trail for every single attempt — safe fields only (never the
  // key/secret/Authorization value itself, only their length + SHA-256
  // fingerprint) — printed BEFORE the request so it's captured even if
  // the process crashes mid-request, and so an operator can diff two log
  // lines to prove whether two different-looking failures actually used
  // the same credentials.
  const [apiKeyFingerprint, secretKeyFingerprint] = await Promise.all([
    sha256Fingerprint(apiKey),
    sha256Fingerprint(secretKey),
  ]);
  console.log(
    `[beem] POST ${apiUrl} authScheme=Basic apiKeyLen=${apiKey.length} apiKeyFp=${apiKeyFingerprint} ` +
      `secretKeyLen=${secretKey.length} secretKeyFp=${secretKeyFingerprint} sender="${senderId}" to=${maskPhone(phone)} messageLen=${body.length}` +
      (warning ? ` senderIdWarning="${warning}"` : '')
  );

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
    console.log(`[beem] request failed before a response: reason=${reasonCode} error="${error.message}"`);
    return { status: 'failed', reasonCode, errorMessage };
  }

  const rawText = await response.text();
  const payload = (() => {
    try {
      return JSON.parse(rawText);
    } catch {
      return null;
    }
  })();

  // Beem's response body never contains our credentials — it's Beem's own
  // reply, safe to log in full. Truncated defensively in case of an
  // unexpectedly large error page (e.g. an HTML 502 from a proxy in
  // front of Beem rather than Beem's own JSON).
  console.log(`[beem] response status=${response.status} body=${rawText.slice(0, 500)}`);

  if (!response.ok || !payload || payload.successful !== true) {
    // Both the HTTP status and Beem's own message text, when Beem sends
    // one — a bare "Invalid Authentication Parameters" alone doesn't tell
    // an operator whether that was a 401 (credentials wrong/expired) or a
    // 403 (credentials valid, but the specific sender ID/action is
    // forbidden — see classifyHttpFailure) or a 400 (malformed request) —
    // the status code narrows that down without exposing the credentials
    // themselves. `reasonCode` gives a caller a stable value to branch on
    // instead of parsing this text.
    const reasonCode = classifyHttpFailure(response.status);
    const beemDetail = payload?.message ?? (rawText ? rawText.slice(0, 200) : null);
    const detail = beemDetail ? `HTTP ${response.status} — ${beemDetail}` : `HTTP ${response.status}`;
    const senderHint = reasonCode === 'forbidden' && warning ? ` (sender ID ${warning})` : '';
    return { status: 'failed', reasonCode, errorMessage: `Beem API: ${detail}${senderHint}` };
  }

  return { status: 'sent', providerMessageId: payload.request_id ? String(payload.request_id) : null };
}

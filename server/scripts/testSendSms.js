// One-off manual CLI script to send a REAL SMS through the production Beem
// adapter (server/src/modules/sms/providers/beemProvider.js) — the exact
// same code path a live contribution/statement SMS uses. Not an HTTP
// endpoint, not wired into the app; run by hand on the server when you
// need to verify Beem delivery end-to-end with the real .env credentials.
//
// Usage (from server/, with the real production .env in place):
//   node scripts/testSendSms.js 255700000000
//
// Never prints BEEM_API_KEY/BEEM_SECRET_KEY — only the same safe
// fingerprint server.js logs at boot, plus the adapter's own result
// (status/reasonCode/errorMessage), which by construction never contains
// a credential (see beemProvider.js).
import { env } from '../src/config/env.js';
import { sendViaBeem } from '../src/modules/sms/providers/beemProvider.js';

function credentialFingerprint(value) {
  if (!value) return 'not set';
  if (value.length < 10) return `configured length=${value.length}`;
  return `configured length=${value.length} prefix=${value.slice(0, 4)}… suffix=…${value.slice(-3)}`;
}

const phone = process.argv[2];
if (!phone) {
  console.error('Usage: node scripts/testSendSms.js <phone-e.g.255700000000>');
  process.exit(1);
}

console.log(`[test-sms] provider=${env.sms.provider} apiUrl=${env.sms.beem.apiUrl}`);
console.log(
  `[test-sms] BEEM_API_KEY=${credentialFingerprint(env.sms.beem.apiKey)} BEEM_SECRET_KEY=${credentialFingerprint(env.sms.beem.secretKey)} BEEM_SENDER_ID=${env.sms.beem.senderId || 'not set'}`
);

if (env.sms.provider !== 'beem') {
  console.error('[test-sms] BEEM_API_KEY/BEEM_SECRET_KEY are not both set — nothing to test. Set them in server/.env and restart.');
  process.exit(1);
}

const result = await sendViaBeem({ phone, body: 'Clix Treasury: this is a live test message (testSendSms.js).' });
console.log('[test-sms] result:', result);
process.exit(result.status === 'sent' ? 0 : 2);

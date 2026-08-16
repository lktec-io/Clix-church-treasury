import { env } from './config/env.js';
import { createApp } from './app.js';

const app = createApp();

// Safe, non-secret fingerprint of a credential for boot-time diagnostics:
// never the value itself, only whether it's set, how long it is, and a
// few characters at each end (enough to confirm "this is the credential I
// think I pasted" / catch a truncated paste or a stray quote/space,
// without ever exposing enough to reconstruct or narrow down the secret).
function credentialFingerprint(value) {
  if (!value) return 'not set';
  if (value.length < 10) return `configured length=${value.length}`;
  return `configured length=${value.length} prefix=${value.slice(0, 4)}… suffix=…${value.slice(-3)}`;
}

app.listen(env.port, () => {
  console.log(`Clix Treasury API listening on port ${env.port} (${env.nodeEnv})`);
  // Safe, non-secret SMS config summary at boot — an operator watching
  // `pm2 logs` after a deploy/restart can immediately see which provider
  // is active and whether the required variables are actually present,
  // without ever printing BEEM_API_KEY/BEEM_SECRET_KEY themselves.
  console.log(
    `[sms] provider=${env.sms.provider} senderConfigured=${Boolean(env.sms.beem.senderId)} apiUrl=${env.sms.beem.apiUrl}` +
      (env.sms.provider === 'noop'
        ? ' (BEEM_API_KEY/BEEM_SECRET_KEY not set — SMS sending is disabled, every attempt logs to sms_log as skipped_no_provider)'
        : '')
  );
  if (env.sms.provider === 'beem') {
    console.log(
      `[sms] BEEM_API_KEY=${credentialFingerprint(env.sms.beem.apiKey)} BEEM_SECRET_KEY=${credentialFingerprint(env.sms.beem.secretKey)} BEEM_SENDER_ID=${env.sms.beem.senderId || 'not set'}`
    );
  }
});

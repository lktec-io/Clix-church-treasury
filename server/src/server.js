import { env } from './config/env.js';
import { createApp } from './app.js';

const app = createApp();

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
});

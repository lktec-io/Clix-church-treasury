// Default provider whenever BEEM_API_KEY/BEEM_SECRET_KEY are not both set
// (server/src/config/env.js). Never attempts a network call, never throws,
// never claims delivery — every attempt is still recorded in sms_log with
// this exact status so nothing is silently dropped or fabricated as sent.
export async function sendViaNoop({ phone, body }) {
  console.log(`[sms:noop] would send to ${phone}:\n${body}`);
  return { status: 'skipped_no_provider', reasonCode: 'not_configured' };
}

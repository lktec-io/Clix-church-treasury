import { env } from '../../config/env.js';
import { smsLogRepository } from './smsLog.repository.js';
import { renderTemplate } from './smsTemplates.js';
import { normalizeTzPhone } from './phoneNumber.js';
import { sendViaBeem } from './providers/beemProvider.js';
import { sendViaNoop } from './providers/noopProvider.js';

// Masks a phone number for logs — enough to identify which recipient
// without printing the full number into server logs (defense in depth,
// same spirit as never logging credentials).
function maskPhone(phone) {
  if (!phone || phone.length < 4) return '***';
  return `${'*'.repeat(Math.max(phone.length - 4, 0))}${phone.slice(-4)}`;
}

// The one entry point every caller sends SMS through — mirrors
// recordAuditLog() being the single hook for audit writes
// (auditLog.service.js). Never throws: a provider failure (network error,
// non-2xx response, bad credentials) is caught and recorded as a 'failed'
// row rather than propagated, because SMS delivery must never be able to
// affect the outcome of the financial operation that triggered it. Callers
// must invoke this only after their own DB transaction has already
// committed (never from inside withTransaction) — see
// contributions.service.js#recordContribution and
// memberAuth/enrollment.service.js for the two call sites.
//
// Every outcome (sent/failed/skipped_no_provider/invalid phone) is also
// printed to the server console with non-secret fields only (provider,
// masked recipient, template, status, safe error text) — an
// operator diagnosing "why didn't the SMS send" from PM2/server logs must
// not have to go query sms_log by hand to find out (the client's own
// requirement: "record enough information to diagnose").
export async function sendSms(
  tenantId,
  { contributorId = null, phone, templateKey, params = {}, locale = 'en', relatedType = null, relatedId = null }
) {
  const body = renderTemplate(templateKey, locale, params);
  const normalizedPhone = normalizeTzPhone(phone);

  let result;
  if (!normalizedPhone) {
    result = { status: 'failed', errorMessage: `Phone number is not a recognizable Tanzanian mobile number (${maskPhone(phone)})` };
  } else {
    try {
      result =
        env.sms.provider === 'beem'
          ? await sendViaBeem({ phone: normalizedPhone, body })
          : await sendViaNoop({ phone: normalizedPhone, body });
    } catch (error) {
      result = { status: 'failed', errorMessage: error.message };
    }
  }

  console.log(
    `[sms] tenant=${tenantId} provider=${env.sms.provider} template=${templateKey} to=${maskPhone(phone)} status=${result.status}` +
      (result.errorMessage ? ` error="${result.errorMessage}"` : '')
  );

  await smsLogRepository.insert(tenantId, {
    contributor_id: contributorId,
    phone,
    template_key: templateKey,
    locale,
    body,
    status: result.status,
    provider_message_id: result.providerMessageId ?? null,
    error_message: result.errorMessage ?? null,
    related_type: relatedType,
    related_id: relatedId,
  });

  return { status: result.status };
}

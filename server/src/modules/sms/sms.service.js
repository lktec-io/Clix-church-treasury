import { env } from '../../config/env.js';
import { smsLogRepository } from './smsLog.repository.js';
import { renderTemplate, SMS_LOCALE } from './smsTemplates.js';
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
  // `locale` is still accepted from callers (they resolve
  // contributor.locale ?? tenant.locale_default) but is no longer what
  // decides the language: SMS bodies are Swahili-only now
  // (smsTemplates.js). It is overridden to SMS_LOCALE below so the sms_log
  // row records the language actually sent — logging 'en' next to a Swahili
  // body would make the delivery audit trail wrong.
  // eslint-disable-next-line no-unused-vars
  { contributorId = null, phone, templateKey, params = {}, locale = SMS_LOCALE, relatedType = null, relatedId = null }
) {
  // Church name in block capitals on every message, applied HERE rather
  // than at each call site so no template and no future caller can miss it:
  // this is the single funnel every SMS in the product passes through.
  // Uppercasing the stored tenant name at send time (instead of storing it
  // capitalised) keeps the database value as the church actually wrote it,
  // which is what the PDFs, the UI and the receipts still render.
  //
  // toLocaleUpperCase, not toUpperCase: Swahili is Latin-script so the two
  // agree today, but a tenant name carrying a locale-sensitive letter
  // (Turkish dotless i being the classic case) would otherwise transform
  // wrongly. Costs nothing to be correct.
  const brandedParams =
    typeof params.churchName === 'string'
      ? { ...params, churchName: params.churchName.toLocaleUpperCase(SMS_LOCALE) }
      : params;

  const body = renderTemplate(templateKey, SMS_LOCALE, brandedParams);
  const sentLocale = SMS_LOCALE;
  const normalizedPhone = normalizeTzPhone(phone);

  let result;
  if (!normalizedPhone) {
    result = {
      status: 'failed',
      reasonCode: 'invalid_phone',
      errorMessage: `Phone number is not a recognizable Tanzanian mobile number (${maskPhone(phone)})`,
    };
  } else {
    try {
      result =
        env.sms.provider === 'beem'
          ? await sendViaBeem({ phone: normalizedPhone, body })
          : await sendViaNoop({ phone: normalizedPhone, body });
    } catch (error) {
      result = { status: 'failed', reasonCode: 'unexpected_error', errorMessage: error.message };
    }
  }

  console.log(
    `[sms] tenant=${tenantId} provider=${env.sms.provider} template=${templateKey} to=${maskPhone(phone)} status=${result.status}` +
      (result.reasonCode ? ` reason=${result.reasonCode}` : '') +
      (result.errorMessage ? ` error="${result.errorMessage}"` : '')
  );

  await smsLogRepository.insert(tenantId, {
    contributor_id: contributorId,
    phone,
    template_key: templateKey,
    locale: sentLocale,
    body,
    status: result.status,
    reason_code: result.reasonCode ?? null,
    provider_message_id: result.providerMessageId ?? null,
    error_message: result.errorMessage ?? null,
    related_type: relatedType,
    related_id: relatedId,
  });

  // errorMessage is always either Beem's own rejection text, this
  // module's own phone-format text, or a network-error message — never a
  // credential/secret (those never flow through `result`) — so it's safe
  // to hand back to callers for staff-facing display (client requirement:
  // "for staff users, surface a concise reason where safe"). reasonCode is
  // a stable machine-readable category (auth/bad_request/rate_limited/
  // timeout/network/invalid_phone/provider_error/provider_rejected) a UI
  // can branch on without parsing errorMessage's free text.
  //
  // `preview` is the exact rendered body that was handed to the provider —
  // the same string persisted to sms_log.body. It is returned so the UI can
  // show a clerk precisely what the member received ("Pop Preview"), rather
  // than the UI re-composing the message client-side and drifting from what
  // was actually sent. Safe to expose: the body is built only from template
  // text plus tenant/contributor fields the caller already has, and no
  // template carries a credential.
  //
  // The one template whose body IS sensitive is member_registration, which
  // embeds a raw PIN — enrollment.service.js must not forward this field to
  // a client. Flagged here because the value is now available to every
  // caller of sendSms().
  return {
    status: result.status,
    reasonCode: result.reasonCode ?? null,
    errorMessage: result.errorMessage ?? null,
    preview: body,
  };
}

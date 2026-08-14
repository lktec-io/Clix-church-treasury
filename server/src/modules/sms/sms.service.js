import { env } from '../../config/env.js';
import { smsLogRepository } from './smsLog.repository.js';
import { renderTemplate } from './smsTemplates.js';
import { sendViaBeem } from './providers/beemProvider.js';
import { sendViaNoop } from './providers/noopProvider.js';

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
export async function sendSms(
  tenantId,
  { contributorId = null, phone, templateKey, params = {}, locale = 'en', relatedType = null, relatedId = null }
) {
  const body = renderTemplate(templateKey, locale, params);

  let result;
  try {
    result = env.sms.provider === 'beem' ? await sendViaBeem({ phone, body }) : await sendViaNoop({ phone, body });
  } catch (error) {
    result = { status: 'failed', errorMessage: error.message };
  }

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

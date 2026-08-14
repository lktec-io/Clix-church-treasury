import bcrypt from 'bcryptjs';
import { withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { notFound, conflict, validationError } from '../../errors/AppError.js';
import { nowSql } from '../../db/time.js';
import { contributorsRepository } from '../contributors/contributors.repository.js';
import { tenantsRepository } from '../tenants/tenants.repository.js';
import { contributorRefreshTokensRepository } from './contributorRefreshTokens.repository.js';
import { nextMemberNumber } from './memberNumber.js';
import { generatePin } from './pin.js';
import { recordAuditLog } from '../audit/auditLog.service.js';
import { sendSms } from '../sms/sms.service.js';

const BCRYPT_COST = 10;
const MAX_NUMBER_ATTEMPTS = 20;

function toPublicContributor(contributor) {
  // Never include pin_hash in any API response — same rule as
  // auth.service.js#toPublicUser for password_hash.
  // eslint-disable-next-line no-unused-vars
  const { pin_hash, failed_pin_attempts, pin_locked_until, ...publicContributor } = contributor;
  return publicContributor;
}

// Loops rather than retry-catch-on-duplicate (contrast pledges.service.js's
// createPledge) because collisions here are expected and cheap to check
// directly: nextMemberNumber always advances the per-tenant counter, so a
// collision can only happen against a member_number a treasurer typed in
// manually before this feature existed — findByMemberNumber settles it in
// one query per attempt, no wasted INSERT-then-catch round trip.
async function allocateMemberNumber(tenantId, connection) {
  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt += 1) {
    const candidate = await nextMemberNumber(tenantId, connection);
    const existing = await contributorsRepository.findByMemberNumber(tenantId, candidate, connection);
    if (!existing) return candidate;
  }
  throw new Error('Could not allocate a unique member number');
}

// Staff-triggered (permission contributors.manage). Generates a member
// number if the contributor doesn't already have one, generates and hashes
// a random PIN, and — only after the DB transaction has committed — sends
// the registration SMS containing the raw PIN. The raw PIN exists only in
// local variables and that one SMS body; it is never logged, never
// returned in this function's result, never stored anywhere but as a hash.
export async function enablePortalAccess(tenantId, contributorId, actorUserId) {
  const { contributor, rawPin } = await withTransaction(async (connection) => {
    const existing = await contributorsRepository.findById(tenantId, contributorId, connection);
    if (!existing) throw notFound('Contributor not found');
    if (existing.portal_enabled_at) {
      throw conflict('Portal access is already enabled for this contributor');
    }
    if (!existing.phone) {
      throw validationError('A phone number is required to enable portal access', { phone: 'required' });
    }

    const memberNumber = existing.member_number ?? (await allocateMemberNumber(tenantId, connection));
    const pin = generatePin();
    const pinHash = await bcrypt.hash(pin, BCRYPT_COST);

    const updated = await contributorsRepository.update(
      tenantId,
      contributorId,
      {
        member_number: memberNumber,
        pin_hash: pinHash,
        must_change_pin: true,
        failed_pin_attempts: 0,
        pin_locked_until: null,
        portal_enabled_at: nowSql(),
      },
      connection
    );

    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'contributor.portal_enabled',
        entityType: 'contributors',
        entityId: contributorId,
        after: { memberNumber },
      },
      connection
    );

    return { contributor: updated, rawPin: pin };
  });

  const tenant = await tenantsRepository.findById(tenantId);
  const sms = await sendSms(tenantId, {
    contributorId: contributor.id,
    phone: contributor.phone,
    templateKey: 'member_registration',
    locale: contributor.locale ?? tenant?.locale_default ?? 'en',
    params: {
      churchName: tenant?.name,
      memberName: contributor.full_name,
      memberNumber: contributor.member_number,
      pin: rawPin,
      portalUrl: `${env.frontendUrl}/member/${tenant?.slug}`,
    },
    relatedType: 'contributors',
    relatedId: contributor.id,
  });

  return { contributor: toPublicContributor(contributor), sms };
}

// Staff-triggered "forgot PIN" resolution — the answer to that requirement
// for this phase (a member-initiated self-service OTP reset is deferred,
// see docs/MASTER_TODO.md). Revokes every existing session so a PIN reset
// also ends any session on a lost/compromised device.
export async function resetPin(tenantId, contributorId, actorUserId) {
  const existing = await contributorsRepository.findById(tenantId, contributorId);
  if (!existing) throw notFound('Contributor not found');
  if (!existing.portal_enabled_at) {
    throw conflict('Portal access is not enabled for this contributor');
  }

  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, BCRYPT_COST);
  const updated = await contributorsRepository.update(tenantId, contributorId, {
    pin_hash: pinHash,
    must_change_pin: true,
    failed_pin_attempts: 0,
    pin_locked_until: null,
  });
  await contributorRefreshTokensRepository.revokeAllForContributor(contributorId);

  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'contributor.pin_reset',
    entityType: 'contributors',
    entityId: contributorId,
  });

  const tenant = await tenantsRepository.findById(tenantId);
  const sms = await sendSms(tenantId, {
    contributorId: updated.id,
    phone: updated.phone,
    templateKey: 'member_registration',
    locale: updated.locale ?? tenant?.locale_default ?? 'en',
    params: {
      churchName: tenant?.name,
      memberName: updated.full_name,
      memberNumber: updated.member_number,
      pin,
      portalUrl: `${env.frontendUrl}/member/${tenant?.slug}`,
    },
    relatedType: 'contributors',
    relatedId: updated.id,
  });

  return { contributor: toPublicContributor(updated), sms };
}

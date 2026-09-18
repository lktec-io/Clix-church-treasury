import { notFound } from '../../errors/AppError.js';
import { withTransaction } from '../../config/db.js';
import { pledgesRepository } from './pledges.repository.js';
import { contributionsRepository } from '../contributions/contributions.repository.js';
import { generatePledgeNumber } from './pledgeNumber.js';
import { recordAuditLog } from '../audit/auditLog.service.js';
import { hardDelete, refuseDelete } from '../../db/deleteGuards.js';
import { subtractMoney } from '../financial/money.js';
import { computePledgeSchedule } from './pledgeSchedule.js';

const MAX_NUMBER_ATTEMPTS = 5;

async function withFulfillment(tenantId, pledge, connection) {
  const { fulfilled, paymentCount } = await pledgesRepository.getFulfillmentStats(tenantId, pledge.id, connection);
  const remaining = subtractMoney(pledge.pledged_amount, fulfilled);
  // `frequency` is undefined on a server where migration 0038 is pending;
  // treat that as the pre-migration meaning, a one-off pledge.
  const frequency = pledge.frequency ?? 'once';
  return {
    ...pledge,
    frequency,
    fulfilled_amount: fulfilled,
    remaining_amount: remaining,
    payment_count: paymentCount,
    schedule: computePledgeSchedule({
      pledgedAmount: pledge.pledged_amount,
      fulfilledAmount: fulfilled,
      pledgeDate: pledge.pledge_date,
      targetDate: pledge.target_date,
      frequency,
    }),
  };
}

export async function createPledge(tenantId, data, actorUserId) {
  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt += 1) {
    const pledgeNumber = generatePledgeNumber();
    try {
      const row = {
        pledge_number: pledgeNumber,
        contributor_id: data.contributorId,
        fund_id: data.fundId,
        pledged_amount: data.pledgedAmount,
        pledge_date: data.pledgeDate,
        target_date: data.targetDate,
        notes: data.notes,
        status: 'active',
        created_by_user_id: actorUserId,
      };
      // Only written when recurring: 'once' is the column default, so a
      // one-off pledge keeps producing the same INSERT and works before
      // migration 0038 is applied.
      if (data.frequency && data.frequency !== 'once') row.frequency = data.frequency;
      const pledge = await pledgesRepository.insert(tenantId, row);
      await recordAuditLog({
        tenantId,
        actorUserId,
        action: 'pledge.created',
        entityType: 'pledges',
        entityId: pledge.id,
        after: { pledgedAmount: data.pledgedAmount, fundId: data.fundId },
      });
      return withFulfillment(tenantId, pledge);
    } catch (error) {
      const isDuplicateNumber = error.code === 'ER_DUP_ENTRY' && error.message.includes('uq_pledges_tenant_number');
      if (!isDuplicateNumber || attempt === MAX_NUMBER_ATTEMPTS - 1) throw error;
    }
  }
  throw new Error('Could not generate a unique pledge number');
}

export async function listPledges(tenantId, filters) {
  const pledges = await pledgesRepository.search(tenantId, filters);
  return Promise.all(pledges.map((p) => withFulfillment(tenantId, p)));
}

export async function getPledge(tenantId, id) {
  const pledge = await pledgesRepository.findById(tenantId, id);
  if (!pledge) throw notFound('Pledge not found');
  return withFulfillment(tenantId, pledge);
}

export async function updatePledge(tenantId, id, updates, actorUserId) {
  const pledge = await pledgesRepository.update(tenantId, id, updates);
  if (!pledge) throw notFound('Pledge not found');
  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'pledge.updated',
    entityType: 'pledges',
    entityId: id,
    after: updates,
  });
  return withFulfillment(tenantId, pledge);
}

export async function setPledgeStatus(tenantId, id, status, actorUserId) {
  const existing = await pledgesRepository.findById(tenantId, id);
  if (!existing) throw notFound('Pledge not found');
  const updated = await pledgesRepository.update(tenantId, id, { status });
  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'pledge.status_changed',
    entityType: 'pledges',
    entityId: id,
    before: { status: existing.status },
    after: { status },
  });
  return withFulfillment(tenantId, updated);
}

// Called after recording or reversing a pledge-linked contribution
// (contributions.service.js). Keeps `status` consistent with actual
// fulfillment without a manual step — but never touches a 'cancelled'
// pledge, which is a terminal, human decision (docs/MASTER_TODO.md Phase 7:
// "do not create a complicated state machine unless the business actually
// requires it" — this is the one small piece of automatic transition that
// clearly does).
export async function syncPledgeStatus(tenantId, pledgeId, connection) {
  const pledge = await pledgesRepository.findById(tenantId, pledgeId, connection);
  if (!pledge || pledge.status === 'cancelled') return;

  const fulfilled = Number(await pledgesRepository.getFulfilledAmount(tenantId, pledgeId, connection));
  const pledged = Number(pledge.pledged_amount);

  if (fulfilled >= pledged && pledge.status !== 'completed') {
    await pledgesRepository.update(tenantId, pledgeId, { status: 'completed' }, connection);
  } else if (fulfilled < pledged && pledge.status === 'completed') {
    await pledgesRepository.update(tenantId, pledgeId, { status: 'active' }, connection);
  }
}

/**
 * PERMANENT DELETE of a pledge.
 *
 * A pledge that has been paid against cannot be deleted: those payments are
 * posted contributions that point at it, and the money is real whatever
 * happens to the promise. Cancelling is the route for a pledge that will not
 * be honoured — it keeps the history and stops accepting payments.
 *
 * Deleting is for the promise recorded by mistake: wrong member, wrong fund,
 * duplicated entry, nothing paid yet.
 */
export async function hardDeletePledge(tenantId, pledgeId, actorUserId) {
  const pledge = await pledgesRepository.findById(tenantId, pledgeId);
  if (!pledge) throw notFound('Pledge not found');

  const payments = await contributionsRepository.search(tenantId, { pledgeId, limit: 1 });
  if (payments.length > 0) {
    refuseDelete(
      'Payments have already been recorded against this pledge, so it cannot be deleted. Cancel it instead — the payments stay in the ledger either way.'
    );
  }

  return withTransaction(async (connection) => {
    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'pledge.deleted',
        entityType: 'pledges',
        entityId: pledgeId,
        before: {
          contributorId: pledge.contributor_id,
          fundId: pledge.fund_id,
          pledgedAmount: pledge.pledged_amount,
          status: pledge.status,
        },
      },
      connection
    );

    await hardDelete(
      'This pledge is still referenced by other records, so it cannot be deleted.',
      () => pledgesRepository.deleteById(tenantId, pledgeId, connection)
    );

    return { id: pledgeId, deleted: true };
  });
}

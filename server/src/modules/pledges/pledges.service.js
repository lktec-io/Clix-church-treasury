import { notFound } from '../../errors/AppError.js';
import { pledgesRepository } from './pledges.repository.js';
import { generatePledgeNumber } from './pledgeNumber.js';
import { recordAuditLog } from '../audit/auditLog.service.js';
import { subtractMoney } from '../financial/money.js';

const MAX_NUMBER_ATTEMPTS = 5;

async function withFulfillment(tenantId, pledge, connection) {
  const fulfilled = await pledgesRepository.getFulfilledAmount(tenantId, pledge.id, connection);
  const remaining = subtractMoney(pledge.pledged_amount, fulfilled);
  return { ...pledge, fulfilled_amount: fulfilled, remaining_amount: remaining };
}

export async function createPledge(tenantId, data, actorUserId) {
  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt += 1) {
    const pledgeNumber = generatePledgeNumber();
    try {
      const pledge = await pledgesRepository.insert(tenantId, {
        pledge_number: pledgeNumber,
        contributor_id: data.contributorId,
        fund_id: data.fundId,
        pledged_amount: data.pledgedAmount,
        pledge_date: data.pledgeDate,
        target_date: data.targetDate,
        notes: data.notes,
        status: 'active',
        created_by_user_id: actorUserId,
      });
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

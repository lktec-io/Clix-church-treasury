import { notFound } from '../../errors/AppError.js';
import { fundsRepository } from './funds.repository.js';
import { recordAuditLog } from '../audit/auditLog.service.js';

export async function listFunds(tenantId) {
  return fundsRepository.findAllByTenant(tenantId);
}

export async function getFund(tenantId, id) {
  const fund = await fundsRepository.findById(tenantId, id);
  if (!fund) throw notFound('Fund not found');
  return fund;
}

export async function createFund(tenantId, data, actorUserId) {
  const fund = await fundsRepository.create(tenantId, data);
  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'fund.created',
    entityType: 'funds',
    entityId: fund.id,
    after: { name: fund.name, isRestricted: fund.is_restricted },
  });
  return fund;
}

export async function renameFund(tenantId, id, name, actorUserId) {
  const before = await fundsRepository.findById(tenantId, id);
  const fund = await fundsRepository.update(tenantId, id, { name });
  if (!fund) throw notFound('Fund not found');
  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'fund.renamed',
    entityType: 'funds',
    entityId: id,
    before: { name: before.name },
    after: { name: fund.name },
  });
  return fund;
}

// No delete endpoint for funds either — deactivation only, same rationale
// as accounts.service.js#setAccountActive.
export async function setFundActive(tenantId, id, isActive, actorUserId) {
  const fund = await fundsRepository.update(tenantId, id, { is_active: isActive });
  if (!fund) throw notFound('Fund not found');
  await recordAuditLog({
    tenantId,
    actorUserId,
    action: isActive ? 'fund.activated' : 'fund.deactivated',
    entityType: 'funds',
    entityId: id,
  });
  return fund;
}

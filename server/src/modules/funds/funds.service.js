import { notFound } from '../../errors/AppError.js';
import { fundsRepository } from './funds.repository.js';

export async function listFunds(tenantId) {
  return fundsRepository.findAllByTenant(tenantId);
}

export async function getFund(tenantId, id) {
  const fund = await fundsRepository.findById(tenantId, id);
  if (!fund) throw notFound('Fund not found');
  return fund;
}

export async function createFund(tenantId, data) {
  return fundsRepository.create(tenantId, data);
}

export async function renameFund(tenantId, id, name) {
  const fund = await fundsRepository.update(tenantId, id, { name });
  if (!fund) throw notFound('Fund not found');
  return fund;
}

// No delete endpoint for funds either — deactivation only, same rationale
// as accounts.service.js#setAccountActive.
export async function setFundActive(tenantId, id, isActive) {
  const fund = await fundsRepository.update(tenantId, id, { is_active: isActive });
  if (!fund) throw notFound('Fund not found');
  return fund;
}

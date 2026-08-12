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

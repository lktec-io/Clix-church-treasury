import { notFound, conflict } from '../../errors/AppError.js';
import { contributorsRepository } from './contributors.repository.js';

export async function listContributors(tenantId) {
  return contributorsRepository.findAllByTenant(tenantId);
}

export async function getContributor(tenantId, id) {
  const contributor = await contributorsRepository.findById(tenantId, id);
  if (!contributor) throw notFound('Contributor not found');
  return contributor;
}

export async function createContributor(tenantId, data) {
  if (data.memberNumber) {
    const existing = await contributorsRepository.findByMemberNumber(tenantId, data.memberNumber);
    if (existing) {
      throw conflict(`Member number "${data.memberNumber}" is already in use`);
    }
  }
  return contributorsRepository.create(tenantId, data);
}

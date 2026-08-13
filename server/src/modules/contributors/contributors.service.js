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
  try {
    return await contributorsRepository.create(tenantId, data);
  } catch (error) {
    // Backstop for the narrow race window above — the DB's own unique
    // constraint is the real guarantee; this only makes a genuine
    // concurrent collision return a friendly 409 instead of a raw 500.
    if (error.code === 'ER_DUP_ENTRY' && error.message.includes('uq_contributors_tenant_member_number')) {
      throw conflict(`Member number "${data.memberNumber}" is already in use`);
    }
    throw error;
  }
}

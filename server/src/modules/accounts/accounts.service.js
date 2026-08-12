import { notFound } from '../../errors/AppError.js';
import { accountsRepository } from './accounts.repository.js';

export async function listAccounts(tenantId) {
  return accountsRepository.findAllByTenant(tenantId);
}

export async function getAccount(tenantId, id) {
  const account = await accountsRepository.findById(tenantId, id);
  if (!account) throw notFound('Account not found');
  return account;
}

export async function createAccount(tenantId, data) {
  return accountsRepository.create(tenantId, data);
}

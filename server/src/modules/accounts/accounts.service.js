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

// Rename only — never a status change through this path, so "deactivate"
// can't be smuggled into what looks like a plain rename request.
export async function renameAccount(tenantId, id, name) {
  const account = await accountsRepository.update(tenantId, id, { name });
  if (!account) throw notFound('Account not found');
  return account;
}

// No delete endpoint exists anywhere for accounts — deactivation is the only
// retirement path, so a fund/account with historical ledger activity can
// never be removed (docs/MASTER_TODO.md Phase 6). RESTRICT foreign keys from
// `transactions` back this up at the DB layer even if this check were ever
// bypassed.
export async function setAccountActive(tenantId, id, isActive) {
  const account = await accountsRepository.update(tenantId, id, { is_active: isActive });
  if (!account) throw notFound('Account not found');
  return account;
}

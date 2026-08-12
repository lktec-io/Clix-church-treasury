import { TenantScopedRepository } from '../../db/TenantScopedRepository.js';

class AccountsRepository extends TenantScopedRepository {
  constructor() {
    super('accounts');
  }

  async create(tenantId, { name, type }, connection) {
    return this.insert(tenantId, { name, type, is_active: true }, connection);
  }
}

export const accountsRepository = new AccountsRepository();

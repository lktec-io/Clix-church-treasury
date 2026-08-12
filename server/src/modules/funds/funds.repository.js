import { TenantScopedRepository } from '../../db/TenantScopedRepository.js';

class FundsRepository extends TenantScopedRepository {
  constructor() {
    super('funds');
  }

  async create(tenantId, { name, isRestricted = false }, connection) {
    return this.insert(tenantId, { name, is_restricted: isRestricted, is_active: true }, connection);
  }
}

export const fundsRepository = new FundsRepository();

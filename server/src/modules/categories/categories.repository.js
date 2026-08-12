import { TenantScopedRepository } from '../../db/TenantScopedRepository.js';

class CategoriesRepository extends TenantScopedRepository {
  constructor() {
    super('categories');
  }

  async create(tenantId, { type, name }, connection) {
    return this.insert(tenantId, { type, name, is_active: true }, connection);
  }
}

export const categoriesRepository = new CategoriesRepository();

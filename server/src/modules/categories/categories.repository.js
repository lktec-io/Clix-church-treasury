import { TenantScopedRepository } from '../../db/TenantScopedRepository.js';

class CategoriesRepository extends TenantScopedRepository {
  constructor() {
    super('categories');
  }

  async findByTypeAndName(tenantId, type, name, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM categories WHERE tenant_id = ? AND type = ? AND name = ? LIMIT 1',
      [tenantId, type, name]
    );
    return rows[0] ?? null;
  }

  async create(tenantId, { type, name, reportGroup = null }, connection) {
    return this.insert(tenantId, { type, name, report_group: reportGroup, is_active: true }, connection);
  }
}

export const categoriesRepository = new CategoriesRepository();

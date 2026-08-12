import { TenantScopedRepository } from '../../db/TenantScopedRepository.js';

class ContributorsRepository extends TenantScopedRepository {
  constructor() {
    super('contributors');
  }

  async findByMemberNumber(tenantId, memberNumber, connection) {
    if (!memberNumber) return null;
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM contributors WHERE tenant_id = ? AND member_number = ? LIMIT 1',
      [tenantId, memberNumber]
    );
    return rows[0] ?? null;
  }

  async create(tenantId, { fullName, phone, email, memberNumber }, connection) {
    return this.insert(
      tenantId,
      {
        full_name: fullName,
        phone: phone ?? null,
        email: email ?? null,
        member_number: memberNumber ?? null,
        is_active: true,
      },
      connection
    );
  }
}

export const contributorsRepository = new ContributorsRepository();

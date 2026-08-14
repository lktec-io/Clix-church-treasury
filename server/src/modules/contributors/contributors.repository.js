import { pool } from '../../config/db.js';
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

  // The same deliberate exception users.repository.js#findByIdAnyTenant
  // documents: the member-portal refresh-token flow only has a
  // contributor_id (from the token record) to start from and must discover
  // that contributor's tenant itself — the tenant_id it returns comes from
  // the server-side row, never client input, so this does not weaken
  // tenant isolation (SECURITY_ARCHITECTURE.md §1).
  async findByIdAnyTenant(id, connection) {
    const [rows] = await this.runner(connection ?? pool).query(
      'SELECT * FROM contributors WHERE id = ? LIMIT 1',
      [id]
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

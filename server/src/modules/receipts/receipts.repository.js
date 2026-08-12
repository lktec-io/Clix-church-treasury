import { TenantScopedRepository } from '../../db/TenantScopedRepository.js';

class ReceiptsRepository extends TenantScopedRepository {
  constructor() {
    super('receipts');
  }

  async findByContributionId(tenantId, contributionId, connection) {
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM receipts WHERE tenant_id = ? AND contribution_id = ? LIMIT 1',
      [tenantId, contributionId]
    );
    return rows[0] ?? null;
  }
}

export const receiptsRepository = new ReceiptsRepository();

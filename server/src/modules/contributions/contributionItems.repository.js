import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';

class ContributionItemsRepository extends TenantScopedRepository {
  constructor() {
    super('contribution_items');
  }

  async insertMany(tenantId, contributionId, items, connection) {
    assertTenantId(tenantId);
    if (!items || items.length === 0) return [];
    const inserted = [];
    for (const item of items) {
      // Sequential, not Promise.all — every insert shares the same
      // transaction connection, and mysql2 connections do not support
      // concurrent queries on one connection.
      inserted.push(
        await this.insert(tenantId, { contribution_id: contributionId, purpose: item.purpose, amount: item.amount }, connection)
      );
    }
    return inserted;
  }

  async findByContributionId(tenantId, contributionId, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM contribution_items WHERE tenant_id = ? AND contribution_id = ? ORDER BY id',
      [tenantId, contributionId]
    );
    return rows;
  }

  // Batch sibling of findByContributionId for the monthly statement, which
  // needs the items of every contribution in a month at once — one query
  // rather than one per contribution, the same N+1 rule
  // userRoles.repository.js#listRolesForUsers already follows.
  async findByContributionIds(tenantId, contributionIds, connection) {
    assertTenantId(tenantId);
    if (!contributionIds || contributionIds.length === 0) return [];
    const placeholders = contributionIds.map(() => '?').join(', ');
    const [rows] = await this.runner(connection).query(
      `SELECT * FROM contribution_items
        WHERE tenant_id = ? AND contribution_id IN (${placeholders})
        ORDER BY contribution_id, id`,
      [tenantId, ...contributionIds]
    );
    return rows;
  }
}

export const contributionItemsRepository = new ContributionItemsRepository();

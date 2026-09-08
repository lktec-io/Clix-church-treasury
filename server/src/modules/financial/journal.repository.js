import { TenantScopedRepository, assertTenantId } from '../../db/TenantScopedRepository.js';
import { nowSql } from '../../db/time.js';

class JournalRepository extends TenantScopedRepository {
  constructor() {
    super('journal_entries');
  }

  async insertEntry(tenantId, data, connection) {
    return this.insert(tenantId, data, connection);
  }

  /**
   * Inserts the DR/CR lines of one entry. The caller
   * (journal.service.js#postJournalEntry) has already asserted that they
   * balance — this only writes them.
   */
  async insertLines(tenantId, journalEntryId, lines, connection) {
    assertTenantId(tenantId);
    if (!lines || lines.length === 0) return [];
    const now = nowSql();
    // One multi-row INSERT rather than a loop: the lines of a single entry
    // are always few and always written together, so there is no reason to
    // pay a round trip each.
    const placeholders = lines.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = lines.flatMap((line) => [
      tenantId,
      journalEntryId,
      line.coaAccountId,
      line.fundId ?? null,
      line.debit,
      line.credit,
      line.description ?? null,
      now,
      now,
    ]);
    await this.runner(connection).query(
      `INSERT INTO journal_lines
         (tenant_id, journal_entry_id, coa_account_id, fund_id, debit, credit, description, created_at, updated_at)
       VALUES ${placeholders}`,
      params
    );
    return lines;
  }

  async findLinesByEntryId(tenantId, journalEntryId, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM journal_lines WHERE tenant_id = ? AND journal_entry_id = ? ORDER BY id',
      [tenantId, journalEntryId]
    );
    return rows;
  }

  async findByTransactionId(tenantId, transactionId, connection) {
    assertTenantId(tenantId);
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM journal_entries WHERE tenant_id = ? AND transaction_id = ? LIMIT 1',
      [tenantId, transactionId]
    );
    return rows[0] ?? null;
  }
}

export const journalRepository = new JournalRepository();

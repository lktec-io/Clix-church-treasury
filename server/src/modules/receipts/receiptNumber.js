import { churchSettingsRepository } from '../tenants/churchSettings.repository.js';

// Row-lock based per-tenant-per-year sequence — safe under concurrency
// because the SELECT ... FOR UPDATE serializes concurrent transactions that
// touch the same (tenant_id, year) row; the second waits for the first to
// commit or roll back, so two receipts can never be issued the same number
// (docs/MASTER_TODO.md Phase 7: "not collide under concurrent requests").
// Must run inside the same DB transaction as the receipt insert.
async function nextSequenceNumber(tenantId, year, connection) {
  const [rows] = await connection.query(
    'SELECT next_number FROM receipt_sequences WHERE tenant_id = ? AND year = ? FOR UPDATE',
    [tenantId, year]
  );
  if (rows.length === 0) {
    await connection.query('INSERT INTO receipt_sequences (tenant_id, year, next_number) VALUES (?, ?, 2)', [
      tenantId,
      year,
    ]);
    return 1;
  }
  const current = rows[0].next_number;
  await connection.query('UPDATE receipt_sequences SET next_number = next_number + 1 WHERE tenant_id = ? AND year = ?', [
    tenantId,
    year,
  ]);
  return current;
}

// Formats church_settings.receipt_number_format (e.g. "RCT-{YYYY}-{SEQ}",
// the Phase 1 default) — {YYYY} = 4-digit year, {SEQ} = zero-padded
// 4-digit sequence number, resetting to 1 each calendar year per tenant.
export async function generateReceiptNumber(tenantId, connection) {
  const year = new Date().getFullYear();
  const sequence = await nextSequenceNumber(tenantId, year, connection);
  const settings = await churchSettingsRepository.findByTenantId(tenantId, connection);
  const format = settings?.receipt_number_format ?? 'RCT-{YYYY}-{SEQ}';
  return format.replace('{YYYY}', String(year)).replace('{SEQ}', String(sequence).padStart(4, '0'));
}

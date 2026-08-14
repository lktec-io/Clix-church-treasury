// Row-lock based per-tenant sequence for auto-generated member numbers
// ("M0001", "M0002", ...) — same SELECT ... FOR UPDATE pattern as
// receipts/receiptNumber.js, but never resets (member numbers are
// permanent identifiers, unlike receipt numbers which reset each year).
// Must run inside the same DB transaction as the contributor update that
// consumes the number (server/src/modules/memberAuth/enrollment.service.js).
export async function nextMemberNumber(tenantId, connection) {
  const [rows] = await connection.query(
    'SELECT next_number FROM contributor_sequences WHERE tenant_id = ? FOR UPDATE',
    [tenantId]
  );
  let current;
  if (rows.length === 0) {
    await connection.query('INSERT INTO contributor_sequences (tenant_id, next_number) VALUES (?, 2)', [tenantId]);
    current = 1;
  } else {
    current = rows[0].next_number;
    await connection.query('UPDATE contributor_sequences SET next_number = next_number + 1 WHERE tenant_id = ?', [
      tenantId,
    ]);
  }
  return `M${String(current).padStart(4, '0')}`;
}

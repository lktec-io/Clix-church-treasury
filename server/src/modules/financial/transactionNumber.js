import crypto from 'node:crypto';

// TXN-YYYYMMDD-XXXXXX. The random suffix plus the unique (tenant_id,
// transaction_number) DB constraint (with a retry loop at the call site)
// makes duplicate numbers structurally impossible rather than merely unlikely.
export function generateTransactionNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TXN-${datePart}-${randomPart}`;
}

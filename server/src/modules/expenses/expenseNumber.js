import crypto from 'node:crypto';

// Same pattern as financial/transactionNumber.js — EXP-YYYYMMDD-XXXXXX,
// uniqueness enforced by a DB constraint plus a generation retry loop, not
// by randomness alone.
export function generateExpenseNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `EXP-${datePart}-${randomPart}`;
}

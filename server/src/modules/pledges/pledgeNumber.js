import crypto from 'node:crypto';

// Same pattern as financial/transactionNumber.js and expenses/expenseNumber.js.
export function generatePledgeNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `PLG-${datePart}-${randomPart}`;
}

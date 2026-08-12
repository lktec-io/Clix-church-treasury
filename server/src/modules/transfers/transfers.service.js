import { notFound } from '../../errors/AppError.js';
import { transfer as engineTransfer } from '../financial/financialEngine.service.js';
import { transactionsRepository } from '../financial/transactions.repository.js';
import { recordAuditLog } from '../audit/auditLog.service.js';

// Thin HTTP-facing wrapper around the Phase 3 engine's transfer() — this
// module has no repository of its own and no parallel financial logic; a
// transfer is, and remains, two linked rows in `transactions`
// (docs/DATABASE_ARCHITECTURE.md §2, "what changed from the original plan").
export async function createTransfer(tenantId, data, actorUserId) {
  const result = await engineTransfer(tenantId, { ...data, createdByUserId: actorUserId });

  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'transfer.created',
    entityType: 'transactions',
    entityId: result.outLeg.id,
    after: {
      amount: data.amount,
      fromAccountId: data.fromAccountId,
      toAccountId: data.toAccountId,
      inLegId: result.inLeg.id,
    },
  });

  return result;
}

// One row per transfer in the list — the 'out' leg is the canonical entry;
// its reference_id points at the paired 'in' leg for anyone who needs both.
export async function listTransfers(tenantId, filters) {
  return transactionsRepository.listHistory(tenantId, { ...filters, type: 'transfer', direction: 'out' });
}

export async function getTransfer(tenantId, id) {
  const outLeg = await transactionsRepository.findById(tenantId, id);
  if (!outLeg || outLeg.type !== 'transfer' || outLeg.direction !== 'out') {
    throw notFound('Transfer not found');
  }
  const inLeg = await transactionsRepository.findById(tenantId, outLeg.reference_id);
  return { outLeg, inLeg };
}

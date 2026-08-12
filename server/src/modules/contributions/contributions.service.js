import { withTransaction } from '../../config/db.js';
import { notFound, AppError } from '../../errors/AppError.js';
import { contributionsRepository } from './contributions.repository.js';
import { postLedgerEntry } from '../financial/financialEngine.service.js';
import { transactionsRepository } from '../financial/transactions.repository.js';
import { getOpenPeriod } from '../financial/financialPeriods.service.js';
import { recordAuditLog } from '../audit/auditLog.service.js';
import { pledgesRepository } from '../pledges/pledges.repository.js';
import { syncPledgeStatus } from '../pledges/pledges.service.js';
import { issueReceiptForContribution } from '../receipts/receipts.service.js';

export { enrichWithContributorInfo } from '../contributors/contributorEnrichment.js';

// Records a contribution AND posts its ledger entry atomically — one DB
// transaction, so there is never a contribution row with no matching
// posted transaction, nor a ledger row with no domain record explaining it.
// Income has no approval workflow (contrast Phase 5's expenses): it posts
// immediately, matching how church treasuries actually record money
// received (docs/FINANCIAL_ARCHITECTURE.md §8 draws this line for expenses,
// not income).
export async function recordContribution(tenantId, data, actorUserId) {
  return withTransaction(async (connection) => {
    const openPeriod = await getOpenPeriod(tenantId, connection);
    if (!openPeriod) throw notFound('No open financial period to post this contribution against');

    // Pledge payment: just a contribution with one extra reference — no
    // separate financial logic (docs/FINANCIAL_ARCHITECTURE.md §7, docs/
    // MASTER_TODO.md Phase 7). Overpayment is rejected by default; the
    // brief allows an explicit business rule to permit it, and none exists
    // yet, so the safe default is to block it.
    if (data.pledgeId) {
      const pledge = await pledgesRepository.findById(tenantId, data.pledgeId, connection);
      if (!pledge) throw notFound('Pledge not found');
      if (pledge.status === 'cancelled') {
        throw new AppError('CONFLICT', 'Cannot record a payment against a cancelled pledge', { status: 409 });
      }
      const fulfilled = Number(await pledgesRepository.getFulfilledAmount(tenantId, data.pledgeId, connection));
      const wouldBe = fulfilled + Number(data.amount);
      if (wouldBe > Number(pledge.pledged_amount) + 0.001) {
        throw new AppError(
          'VALIDATION_ERROR',
          `This payment would exceed the pledge (pledged ${pledge.pledged_amount}, already paid ${fulfilled.toFixed(2)})`,
          { status: 422, fields: { amount: 'exceeds remaining pledge balance' } }
        );
      }
    }

    const transaction = await postLedgerEntry(connection, tenantId, {
      type: 'income',
      direction: 'in',
      accountId: data.accountId,
      fundId: data.fundId,
      categoryId: data.categoryId,
      financialPeriodId: openPeriod.id,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      referenceType: 'contributions',
      description: data.notes,
      createdByUserId: actorUserId,
    });

    const contribution = await contributionsRepository.insert(
      tenantId,
      {
        contributor_id: data.contributorId,
        pledge_id: data.pledgeId ?? null,
        account_id: data.accountId,
        fund_id: data.fundId,
        category_id: data.categoryId,
        transaction_id: transaction.id,
        amount: data.amount,
        payment_method: data.paymentMethod,
        contribution_date: data.contributionDate,
        reference: data.reference,
        notes: data.notes,
        status: 'posted',
        recorded_by_user_id: actorUserId,
      },
      connection
    );

    // Ledger row's reference_id points back at the domain row it belongs to
    // — the one sanctioned post-insert linkage mutation (see financialEngine
    // .service.js's transfer() for the same pattern).
    await transactionsRepository.update(tenantId, transaction.id, { reference_id: contribution.id }, connection);

    if (data.pledgeId) {
      await syncPledgeStatus(tenantId, data.pledgeId, connection);
    }

    // Every contribution gets exactly one receipt, issued atomically with it
    // — there is no code path that creates a contribution without one.
    const receipt = await issueReceiptForContribution(tenantId, contribution.id, actorUserId, connection);

    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'contribution.recorded',
        entityType: 'contributions',
        entityId: contribution.id,
        after: { amount: data.amount, fundId: data.fundId, transactionId: transaction.id, pledgeId: data.pledgeId },
      },
      connection
    );

    return { ...contribution, transaction, receipt };
  });
}

export async function listContributions(tenantId, filters) {
  return contributionsRepository.search(tenantId, filters);
}

export async function getContribution(tenantId, id) {
  const contribution = await contributionsRepository.findById(tenantId, id);
  if (!contribution) throw notFound('Contribution not found');
  return contribution;
}


export async function updateContribution(tenantId, id, updates, actorUserId) {
  const existing = await contributionsRepository.findById(tenantId, id);
  if (!existing) throw notFound('Contribution not found');

  const updated = await contributionsRepository.update(tenantId, id, updates);

  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'contribution.updated',
    entityType: 'contributions',
    entityId: id,
    before: { reference: existing.reference, notes: existing.notes, contributor_id: existing.contributor_id },
    after: updates,
  });

  return updated;
}

export async function reverseContribution(tenantId, id, reason, actorUserId) {
  return withTransaction(async (connection) => {
    const contribution = await contributionsRepository.findById(tenantId, id, connection);
    if (!contribution) throw notFound('Contribution not found');
    if (contribution.status === 'reversed') {
      throw new AppError('CONFLICT', 'This contribution has already been reversed', { status: 409 });
    }

    // financialEngine.service.js's reverseTransaction() opens its own DB
    // transaction, which can't be composed with this one — the contribution
    // row's status update must commit atomically together with the reversal
    // ledger entry, so this calls the same lower-level primitive
    // (postLedgerEntry) directly against this transaction's connection instead.
    const original = await transactionsRepository.findById(tenantId, contribution.transaction_id, connection);
    if (!original || original.status !== 'posted') {
      throw new AppError('CONFLICT', 'The linked transaction is not in a reversible state', { status: 409 });
    }

    const openPeriod = await getOpenPeriod(tenantId, connection);
    if (!openPeriod) throw notFound('No open financial period to post the reversal against');

    const reversal = await postLedgerEntry(connection, tenantId, {
      type: 'reversal',
      direction: original.direction === 'in' ? 'out' : 'in',
      accountId: original.account_id,
      fundId: original.fund_id,
      categoryId: original.category_id,
      financialPeriodId: openPeriod.id,
      amount: original.amount,
      description: reason,
      referenceType: 'transactions',
      referenceId: original.id,
      createdByUserId: actorUserId,
    });

    await transactionsRepository.update(
      tenantId,
      original.id,
      { status: 'reversed', reversed_by_transaction_id: reversal.id },
      connection
    );

    const updatedContribution = await contributionsRepository.update(
      tenantId,
      id,
      { status: 'reversed' },
      connection
    );

    if (contribution.pledge_id) {
      await syncPledgeStatus(tenantId, contribution.pledge_id, connection);
    }

    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'contribution.reversed',
        entityType: 'contributions',
        entityId: id,
        after: { reason, reversalTransactionId: reversal.id },
      },
      connection
    );

    return updatedContribution;
  });
}

import { withTransaction } from '../../config/db.js';
import { notFound, AppError } from '../../errors/AppError.js';
import { contributionsRepository } from './contributions.repository.js';
import { contributionItemsRepository } from './contributionItems.repository.js';
import { postLedgerEntry } from '../financial/financialEngine.service.js';
import { transactionsRepository } from '../financial/transactions.repository.js';
import { getOpenPeriod } from '../financial/financialPeriods.service.js';
import { recordAuditLog } from '../audit/auditLog.service.js';
import { pledgesRepository } from '../pledges/pledges.repository.js';
import { syncPledgeStatus } from '../pledges/pledges.service.js';
import { issueReceiptForContribution } from '../receipts/receipts.service.js';
import { receiptsRepository } from '../receipts/receipts.repository.js';
import { addMoney, compareMoney } from '../financial/money.js';
import { formatMoney } from '../financial/moneyFormat.js';
import { contributorsRepository } from '../contributors/contributors.repository.js';
import { tenantsRepository } from '../tenants/tenants.repository.js';
import { categoriesRepository } from '../categories/categories.repository.js';
import { sendSms } from '../sms/sms.service.js';

export { enrichWithContributorInfo } from '../contributors/contributorEnrichment.js';

// Shared by recordContribution's post-commit SMS attempt and the standalone
// resend-sms endpoint (contributions.controller.js#resendSms) — same
// lookups, same template, same params, so "try again" sends literally the
// same confirmation, not a different message. Returns null (no SMS
// attempted, not an error) when the contribution has no contributor or the
// contributor has no phone on file.
async function sendContributionConfirmationSms(tenantId, contribution) {
  if (!contribution.contributor_id) return null;
  const [contributor, tenant, category] = await Promise.all([
    contributorsRepository.findById(tenantId, contribution.contributor_id),
    tenantsRepository.findById(tenantId),
    categoriesRepository.findById(tenantId, contribution.category_id),
  ]);
  if (!contributor?.phone) return null;

  const receipt = contribution.receipt ?? (await receiptsRepository.findByContributionId(tenantId, contribution.id));

  return sendSms(tenantId, {
    contributorId: contributor.id,
    phone: contributor.phone,
    templateKey: 'contribution_confirmation',
    locale: contributor.locale ?? tenant?.locale_default ?? 'en',
    params: {
      churchName: tenant?.name,
      memberName: contributor.full_name,
      amount: `${tenant?.base_currency ?? ''} ${formatMoney(contribution.amount)}`.trim(),
      date: contribution.contribution_date,
      reference: receipt?.receipt_number ?? category?.name ?? '',
    },
    relatedType: 'contributions',
    relatedId: contribution.id,
  });
}

// Records a contribution AND posts its ledger entry atomically — one DB
// transaction, so there is never a contribution row with no matching
// posted transaction, nor a ledger row with no domain record explaining it.
// Income has no approval workflow (contrast Phase 5's expenses): it posts
// immediately, matching how church treasuries actually record money
// received (docs/FINANCIAL_ARCHITECTURE.md §8 draws this line for expenses,
// not income).
export async function recordContribution(tenantId, data, actorUserId) {
  // Duplicate-submission guard: a double-click, a slow-network retry, or a
  // treasurer resubmitting after an ambiguous timeout must never post the
  // same payment twice. If the caller sent an idempotencyKey and a
  // contribution with that key already exists, return it as-is instead of
  // doing any financial work — deliberately checked before opening the
  // transaction, so a duplicate request never even acquires the open-period
  // read or a ledger row. See contributions.controller.js#create — this is
  // an early-return, not an error; the caller's request did succeed, just
  // on the first attempt.
  if (data.idempotencyKey) {
    const existing = await contributionsRepository.findByIdempotencyKey(tenantId, data.idempotencyKey);
    if (existing) {
      const [items, receipt] = await Promise.all([
        contributionItemsRepository.findByContributionId(tenantId, existing.id),
        receiptsRepository.findByContributionId(tenantId, existing.id),
      ]);
      return { ...existing, receipt, items, sms: null, deduplicated: true };
    }
  }

  let result;
  try {
    result = await withTransaction(async (connection) => {
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
      const fulfilled = await pledgesRepository.getFulfilledAmount(tenantId, data.pledgeId, connection);
      const wouldBe = addMoney(fulfilled, data.amount);
      if (compareMoney(wouldBe, pledge.pledged_amount) > 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          `This payment would exceed the pledge (pledged ${pledge.pledged_amount}, already paid ${fulfilled})`,
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
        idempotency_key: data.idempotencyKey ?? null,
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

    // Optional receipt/statement-level breakdown — see contribution_items
    // migration (0028) for why this doesn't touch the ledger. Already
    // validated to sum to data.amount by contributions.validator.js.
    const items = data.items
      ? await contributionItemsRepository.insertMany(tenantId, contribution.id, data.items, connection)
      : [];

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

    return { ...contribution, transaction, receipt, items };
    });
  } catch (error) {
    // Backstop for the narrow race window the pre-check above can't close
    // on its own (two requests carrying the same idempotencyKey arriving
    // close enough together that both pass the pre-check before either
    // commits) — same pattern already used for member-number/category
    // uniqueness elsewhere in this codebase. The UNIQUE index is the real
    // guarantee; this only turns a genuine collision into "here's the
    // contribution that already exists" instead of a raw 500.
    if (
      data.idempotencyKey &&
      error.code === 'ER_DUP_ENTRY' &&
      error.message?.includes('uq_contributions_tenant_idempotency')
    ) {
      const existing = await contributionsRepository.findByIdempotencyKey(tenantId, data.idempotencyKey);
      if (existing) {
        const [items, receipt] = await Promise.all([
          contributionItemsRepository.findByContributionId(tenantId, existing.id),
          receiptsRepository.findByContributionId(tenantId, existing.id),
        ]);
        return { ...existing, receipt, items, sms: null, deduplicated: true };
      }
    }
    throw error;
  }

  // SMS confirmation happens strictly after the transaction above has
  // committed — a slow or failed SMS must never be able to roll back a
  // valid, already-posted contribution (sendSms() itself also never
  // throws, as defense in depth). Returns null (not an error) when the
  // contribution has no contributor or the contributor has no phone.
  const sms = await sendContributionConfirmationSms(tenantId, result);
  return { ...result, sms };
}

// Staff-triggered "Jaribu Kutuma SMS Tena" (try sending SMS again) —
// re-sends the exact same confirmation message a fresh recordContribution
// call would have sent, without touching the already-posted financial
// record at all. Exists because SMS failure must be recoverable without a
// treasurer having to re-enter the whole contribution (docs/MASTER_TODO.md:
// "provide a secondary action where appropriate").
export async function resendContributionSms(tenantId, contributionId) {
  const contribution = await contributionsRepository.findById(tenantId, contributionId);
  if (!contribution) throw notFound('Contribution not found');
  const sms = await sendContributionConfirmationSms(tenantId, contribution);
  if (!sms) {
    throw new AppError('NO_PHONE', 'This contributor has no phone number on file to send an SMS to', { status: 409 });
  }
  return sms;
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

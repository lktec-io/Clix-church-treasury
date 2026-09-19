import { withTransaction } from '../../config/db.js';
import { notFound, AppError, validationError } from '../../errors/AppError.js';
import { departmentsRepository } from '../departments/departments.repository.js';
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
import { accrueRemittanceForContribution } from '../remittance/remittance.service.js';
import { runInBackground } from '../../utils/backgroundJob.js';

export { enrichWithContributorInfo } from '../contributors/contributorEnrichment.js';

// Builds the exact same response shape recordContribution's normal success
// path returns ({...contribution, transaction, receipt, items}) for an
// idempotency-deduplicated request — both the pre-check and the
// ER_DUP_ENTRY backstop below hit this. A caller (frontend or a future
// API consumer) must see one consistent contract regardless of whether
// this was the first attempt or a detected duplicate; `deduplicated: true`
// is the only difference, added on top so a caller CAN distinguish the
// two if it cares, without the base shape ever changing underneath it.
async function loadContributionResponse(tenantId, contribution) {
  const [transaction, items, receipt] = await Promise.all([
    transactionsRepository.findById(tenantId, contribution.transaction_id),
    contributionItemsRepository.findByContributionId(tenantId, contribution.id),
    receiptsRepository.findByContributionId(tenantId, contribution.id),
  ]);
  // A duplicate never sends a second SMS: the member was (or was not)
  // notified by the original request.
  return { ...contribution, transaction, receipt, items, sms: null, sms_status: 'skipped', deduplicated: true };
}

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
    locale: contributor.locale ?? tenant?.locale_default ?? 'sw',
    params: {
      churchName: tenant?.name,
      memberName: contributor.full_name,
      // currency is its own placeholder in the template now — amount must
      // stay BARE here or the message renders "TZS TZS 50,000.00".
      currency: tenant?.base_currency ?? 'TZS',
      amount: formatMoney(contribution.amount),
      date: contribution.contribution_date,
      reference: receipt?.receipt_number ?? category?.name ?? '',
    },
    relatedType: 'contributions',
    relatedId: contribution.id,
  });
}

/**
 * Schedules the member's confirmation SMS OUTSIDE the request and returns
 * immediately with what was done: 'queued', or 'skipped' when the gift has no
 * contributor to notify.
 *
 * WHY setImmediate: everything about the SMS — the contributor, tenant and
 * category lookups, the provider call, the sms_log insert (migrations 0030 /
 * 0033) — happens after the contribution has committed and has no bearing on
 * whether it is correct. Running it in the request made the request's status
 * depend on it: a missing sms_log column or a misconfigured gateway turned a
 * successfully recorded gift into a 500, and a treasurer who retried then
 * posted it twice. On the next turn of the event loop the response has
 * already been sent, so nothing here can change it.
 *
 * The job's own failures are caught in full and logged loudly — an unhandled
 * rejection must never take the worker process down. The outcome is recorded
 * in sms_log when that table is usable, and the Collections ledger's resend
 * action retries it on demand.
 */
function scheduleConfirmationSms(tenantId, contribution) {
  if (!contribution.contributor_id) return 'skipped';

  // runInBackground catches and logs any failure of the job itself, so the
  // body only reports the outcomes that are not exceptions.
  runInBackground(`confirmation SMS for contribution ${contribution.id} (recorded; SMS only)`, async () => {
    const sms = await sendContributionConfirmationSms(tenantId, contribution);
    if (!sms) {
      console.log(`[contributions] contribution ${contribution.id}: no SMS sent (contributor has no phone on file)`);
    } else if (sms.status !== 'sent') {
      console.warn(
        `[contributions] contribution ${contribution.id}: confirmation SMS ${sms.status}` +
          (sms.reasonCode ? ` (${sms.reasonCode})` : '')
      );
    }
  });

  return 'queued';
}

// The expense category every mobile-money agent fee posts against. Created
// on first use for churches whose database predates migration 0039 (which
// seeds it), so posting never depends on a treasurer having created a
// category by hand. Matched on the exact seeded name, which is also what the
// migration inserts, so the two can never diverge into duplicates.
const MAKATO_CATEGORY_NAME = 'Makato (Mobile Money Fees)';

async function resolveMakatoCategory(tenantId, connection) {
  const existing = await categoriesRepository.findByTypeAndName(tenantId, 'expense', MAKATO_CATEGORY_NAME, connection);
  if (existing) return existing;
  return categoriesRepository.create(tenantId, { type: 'expense', name: MAKATO_CATEGORY_NAME }, connection);
}

/**
 * Posts the agent fee as its own expense transaction, inside the caller's
 * DB transaction, and returns it.
 *
 * WHY A SECOND TRANSACTION RATHER THAN A SMALLER INCOME ONE: the member gave
 * the full amount and their statement must say so, while the church's
 * account only ever received the remainder. Two entries state both facts and
 * leave the account balance correct:
 *
 *   income  10,000  DR Cash/Bank         CR Contributions Revenue
 *   expense    500  DR Mobile Money Fees CR Cash/Bank
 *
 * Same account, same fund and same open period as the contribution, so the
 * pair can never straddle two periods.
 */
async function postMakatoFee(connection, tenantId, { data, openPeriod, actorUserId }) {
  const category = await resolveMakatoCategory(tenantId, connection);
  return postLedgerEntry(connection, tenantId, {
    type: 'expense',
    direction: 'out',
    accountId: data.accountId,
    fundId: data.fundId,
    categoryId: category.id,
    financialPeriodId: openPeriod.id,
    amount: data.transferFee,
    paymentMethod: data.paymentMethod,
    referenceType: 'contributions',
    description: `Makato — ${data.mobileProvider ?? 'mobile money'}`,
    createdByUserId: actorUserId,
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
      return loadContributionResponse(tenantId, existing);
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

    // HIGHER-BODY ACCRUAL. If this fund carries a remittance rule (Zaka →
    // Conference at 100%, say), the share owed upward is accrued the moment
    // the contribution is recorded — not at period close — so "what do we
    // owe the Conference right now" is always answerable.
    //
    // Inside the same transaction as the posting above on purpose: a tithe
    // that commits without its obligation would silently understate what
    // the church owes, and an understated liability is worse than a
    // refused entry. No rule on the fund means this is a no-op.
    await accrueRemittanceForContribution(connection, tenantId, {
      fundId: data.fundId,
      amount: data.amount,
      financialPeriodId: openPeriod.id,
    });

    const contributionRow = {
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
    };

    // Migration-0038 columns join the INSERT only when used. A contribution
    // recorded without a department or a mobile-money fee writes exactly the
    // columns it always did, so it keeps working on a server whose database
    // has not been migrated yet — recording income is the core of the
    // product and must not break over an optional field.
    //
    // `amount` stays the FULL amount the member sent; the fee is recorded
    // beside it, never subtracted from it (see migration 0038). The member's
    // tithe statement must show what they gave, not what the agent left.
    if (data.departmentId) {
      const department = await departmentsRepository.findById(tenantId, data.departmentId, connection);
      if (!department || !department.is_active) {
        throw validationError('Invalid department', {
          departmentId: 'must reference an active department of this church',
        });
      }
      contributionRow.department_id = data.departmentId;
    }
    if (data.mobileProvider) contributionRow.mobile_provider = data.mobileProvider;
    if (data.transferFee !== null && data.transferFee !== undefined) contributionRow.transfer_fee = data.transferFee;

    // MAKATO. A fee greater than zero posts its own expense entry (migration
    // 0039) so the account balance reflects what actually arrived. A zero or
    // absent fee posts nothing at all — an empty expense row would clutter
    // every ledger and report for no information.
    const feeTransaction =
      data.transferFee && compareMoney(data.transferFee, '0.00') > 0
        ? await postMakatoFee(connection, tenantId, { data, openPeriod, actorUserId })
        : null;
    if (feeTransaction) contributionRow.fee_transaction_id = feeTransaction.id;

    const contribution = await contributionsRepository.insert(tenantId, contributionRow, connection);

    // The fee line points back at the contribution it was charged on, the
    // same post-insert linkage the income row gets below.
    if (feeTransaction) {
      await transactionsRepository.update(tenantId, feeTransaction.id, { reference_id: contribution.id }, connection);
    }

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
        after: {
          amount: data.amount,
          fundId: data.fundId,
          transactionId: transaction.id,
          pledgeId: data.pledgeId,
          transferFee: data.transferFee ?? null,
          feeTransactionId: feeTransaction?.id ?? null,
        },
      },
      connection
    );

    return { ...contribution, transaction, feeTransaction, receipt, items };
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
        return loadContributionResponse(tenantId, existing);
      }
    }
    throw error;
  }

  // The transaction has committed: the gift, its ledger entries and its
  // receipt exist. Everything from here is notification, and it runs in the
  // background (scheduleConfirmationSms) so no part of it can turn this
  // successful write into an error response.
  const smsStatus = scheduleConfirmationSms(tenantId, result);
  return { ...result, sms: { status: smsStatus }, sms_status: smsStatus };
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

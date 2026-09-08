import { withTransaction } from '../../config/db.js';
import { AppError, notFound, validationError } from '../../errors/AppError.js';
import { remittanceRulesRepository, remittanceLedgersRepository } from './remittance.repository.js';
import { fundsRepository } from '../funds/funds.repository.js';
import { postLedgerEntry } from '../financial/financialEngine.service.js';
import { getOpenPeriod } from '../financial/financialPeriods.service.js';
import { recordAuditLog } from '../audit/auditLog.service.js';
import { addMoney, subtractMoney, compareMoney, isPositiveMoneyString, normalizeMoney } from '../financial/money.js';

/**
 * The share of `amount` owed upward under a rule, as a money string.
 *
 * Computed in integer CENTS, never with floats: 100_000.00 * 0.1 in binary
 * floating point is not 10_000.00, and this figure is a debt to a
 * Conference that will be reconciled against their own records.
 *
 * Rounds half-up at the cent, which is the conventional direction for a
 * remittance — the local church never under-remits by a rounding choice.
 */
export function computeRemittanceShare(amount, percentage) {
  const [whole, frac = ''] = normalizeMoney(amount).split('.');
  const amountCents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2));
  // percentage is DECIMAL(5,2) — scale it to basis points (x100) the same way.
  const [pWhole, pFrac = ''] = normalizeMoney(percentage).split('.');
  const percentBp = BigInt(pWhole) * 100n + BigInt(pFrac.padEnd(2, '0').slice(0, 2));

  // amountCents * percentBp / 10000, half-up.
  const numerator = amountCents * percentBp;
  const shareCents = (numerator + 5000n) / 10000n;
  return `${shareCents / 100n}.${String(shareCents % 100n).padStart(2, '0')}`;
}

/**
 * THE ACCRUAL HOOK.
 *
 * Called from contributions.service.js inside the SAME DB transaction that
 * posts the contribution, so a recorded tithe and the obligation it creates
 * commit together. If this throws, the contribution rolls back too — which
 * is the correct coupling: a tithe recorded without its Conference share
 * accrued is a silently understated liability, and understating what the
 * church owes is worse than refusing the entry.
 *
 * Returns null (not an error) when the fund carries no active rule, which
 * is the common case — most funds are local and remit nothing.
 */
export async function accrueRemittanceForContribution(connection, tenantId, { fundId, amount, financialPeriodId }) {
  const rule = await remittanceRulesRepository.findActiveByFundId(tenantId, fundId, connection);
  if (!rule) return null;

  const share = computeRemittanceShare(amount, rule.percentage_to_remit);
  // A 0% rule, or an amount too small to round up to a cent, accrues
  // nothing — skip the write rather than storing a no-op row.
  if (compareMoney(share, '0.00') <= 0) return null;

  return remittanceLedgersRepository.accrue(
    tenantId,
    { financialPeriodId, ruleId: rule.id, fundId, amount: share },
    connection
  );
}

export async function listRules(tenantId) {
  return remittanceRulesRepository.listWithFund(tenantId);
}

export async function createRule(tenantId, { fundId, higherBodyName, percentageToRemit }, actorUserId) {
  const fund = await fundsRepository.findById(tenantId, fundId);
  if (!fund) throw validationError('Invalid fund', { fundId: 'must reference a fund owned by this tenant' });

  const rule = await remittanceRulesRepository.insert(tenantId, {
    fund_id: fundId,
    higher_body_name: higherBodyName,
    percentage_to_remit: percentageToRemit,
    status: 'active',
  });

  await recordAuditLog({
    tenantId,
    actorUserId,
    action: 'remittance.rule_created',
    entityType: 'remittance_rules',
    entityId: rule.id,
    after: { fundId, higherBodyName, percentageToRemit },
  });
  return rule;
}

/**
 * The hub's summary. Totals are derived from the buckets rather than
 * recomputed from contributions — the accrual is the record of what is
 * owed, and recomputing it here would create a second answer that could
 * disagree with the first (docs/FINANCIAL_ARCHITECTURE.md §6).
 */
export async function getRemittanceOverview(tenantId, { financialPeriodId } = {}) {
  const ledgers = await remittanceLedgersRepository.listDetailed(tenantId, { financialPeriodId });
  const totals = ledgers.reduce(
    (acc, row) => ({
      accrued: addMoney(acc.accrued, row.amount_accrued),
      paid: addMoney(acc.paid, row.amount_paid),
    }),
    { accrued: '0.00', paid: '0.00' }
  );
  return {
    ledgers,
    totalAccrued: totals.accrued,
    totalPaid: totals.paid,
    outstanding: subtractMoney(totals.accrued, totals.paid),
  };
}

/**
 * Executes a remittance payout.
 *
 * The money movement is a NORMAL expense transaction through
 * postLedgerEntry — the same single posting path every other movement uses
 * — so it lands in the cash ledger, the general ledger and every report
 * automatically. There is no parallel set of remittance books.
 */
export async function remitToHigherBody(tenantId, ledgerId, { accountId, amount, description }, actorUserId) {
  if (!isPositiveMoneyString(amount)) {
    throw validationError('Invalid amount', { amount: 'must be a positive decimal string with at most 2 places' });
  }

  return withTransaction(async (connection) => {
    const ledger = await remittanceLedgersRepository.findById(tenantId, ledgerId, connection);
    if (!ledger) throw notFound('Remittance record not found');

    const outstanding = subtractMoney(ledger.amount_accrued, ledger.amount_paid);
    if (compareMoney(outstanding, '0.00') <= 0) {
      throw new AppError('CONFLICT', 'This remittance has already been fully paid', { status: 409 });
    }
    // Over-remitting would make amount_paid exceed the accrual and leave
    // the status flag describing a state the numbers contradict. The cap is
    // the outstanding balance, and the caller is told the real figure.
    if (compareMoney(amount, outstanding) > 0) {
      throw validationError('Amount exceeds the outstanding remittance', {
        amount: `at most ${outstanding} is outstanding on this remittance`,
      });
    }

    const openPeriod = await getOpenPeriod(tenantId, connection);
    if (!openPeriod) throw notFound('No open financial period to post the remittance against');

    const transaction = await postLedgerEntry(connection, tenantId, {
      type: 'expense',
      direction: 'out',
      accountId,
      fundId: ledger.fund_id,
      financialPeriodId: openPeriod.id,
      amount,
      description: description ?? 'Higher-body remittance',
      referenceType: 'remittance_ledgers',
      referenceId: ledger.id,
      createdByUserId: actorUserId,
    });

    const updated = await remittanceLedgersRepository.recordPayment(tenantId, ledger.id, amount, connection);

    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'remittance.paid',
        entityType: 'remittance_ledgers',
        entityId: ledger.id,
        before: { amountPaid: ledger.amount_paid, statusFlag: ledger.status_flag },
        after: { amountPaid: updated.amount_paid, statusFlag: updated.status_flag, transactionId: transaction.id },
      },
      connection
    );

    return { ledger: updated, transaction };
  });
}

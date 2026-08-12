import { notFound } from '../../errors/AppError.js';
import { financialPeriodsRepository } from './financialPeriods.repository.js';
import { transactionsRepository } from './transactions.repository.js';
import { fundsRepository } from '../funds/funds.repository.js';
import { accountsRepository } from '../accounts/accounts.repository.js';
import { expensesRepository } from '../expenses/expenses.repository.js';

// The one place "opening balance / income / expenses / transfers /
// adjustments / closing balance" is computed — used by both Phase 8's
// closing summary and Phase 9's Financial Summary report, so those two
// screens can never disagree (docs/FINANCIAL_ARCHITECTURE.md §6,
// docs/MASTER_TODO.md Phase 9 "Report Consistency"). Every figure is a
// live query against the ledger — nothing here is stored or cached
// (docs/FINANCIAL_ARCHITECTURE.md §2: the snapshot-caching optimization
// was deliberately deferred as unnecessary complexity for this product's
// expected scale).
export async function getFinancialSummary(tenantId, financialPeriodId) {
  const period = await financialPeriodsRepository.findById(tenantId, financialPeriodId);
  if (!period) throw notFound('Financial period not found');

  const [openingBalance, closingBalance, totalIncome, totalExpenses, transferVolume, netAdjustments, funds, accounts] =
    await Promise.all([
      transactionsRepository.sumSignedThroughPeriodDate(tenantId, period.start_date, { inclusive: false }),
      transactionsRepository.sumSignedThroughPeriodDate(tenantId, period.end_date, { inclusive: true }),
      transactionsRepository.sumByType(tenantId, 'income', { financialPeriodId }),
      transactionsRepository.sumByType(tenantId, 'expense', { financialPeriodId }),
      transactionsRepository.sumByType(tenantId, 'transfer', { financialPeriodId, direction: 'out' }),
      transactionsRepository.sumSigned(tenantId, { financialPeriodId, type: 'adjustment' }),
      fundsRepository.findAllByTenant(tenantId),
      accountsRepository.findAllByTenant(tenantId),
    ]);

  const fundSummaries = await Promise.all(
    funds.map(async (fund) => ({
      fundId: fund.id,
      name: fund.name,
      balance: await transactionsRepository.sumSigned(tenantId, { fundId: fund.id, financialPeriodId }),
    }))
  );
  const accountSummaries = await Promise.all(
    accounts.map(async (account) => ({
      accountId: account.id,
      name: account.name,
      balance: await transactionsRepository.sumSigned(tenantId, { accountId: account.id, financialPeriodId }),
    }))
  );

  return {
    period,
    openingBalance,
    totalIncome,
    totalExpenses,
    transferVolume,
    netAdjustments,
    closingBalance,
    fundSummaries,
    accountSummaries,
  };
}

// Informational only — closing is never hard-blocked by these (docs/
// MASTER_TODO.md Phase 8: "only financially important issues should block
// closing"; this architecture has no draft/pending ledger rows at all —
// every posting is final on insert, see docs/FINANCIAL_ARCHITECTURE.md §1 —
// so there is no genuinely blocking condition beyond the period already
// being closed, which the close endpoint itself rejects).
export async function getClosingChecklist(tenantId, financialPeriodId) {
  const [pendingExpenses, summary] = await Promise.all([
    expensesRepository.search(tenantId, { status: 'submitted', limit: 500 }),
    getFinancialSummary(tenantId, financialPeriodId),
  ]);
  const approvedUnpaid = await expensesRepository.search(tenantId, { status: 'approved', limit: 500 });

  return {
    pendingApprovalCount: pendingExpenses.length,
    approvedUnpaidCount: approvedUnpaid.length,
    previewSummary: summary,
  };
}

import { nowSql } from '../../db/time.js';
import { AppError } from '../../errors/AppError.js';
import { chartOfAccountsRepository } from './chartOfAccounts.repository.js';
import { journalRepository } from './journal.repository.js';
import { addMoney } from './money.js';

// Turns one posted `transactions` row into a balanced double-entry journal
// entry. Called from financialEngine.postLedgerEntry, inside the caller's
// DB transaction, so a transaction row and its journal entry either both
// exist or neither does.
//
// THE POSTING MATRIX
// ------------------
//   income      in   DR Cash/Bank        CR Contribution Revenue
//   expense     out  DR Expense          CR Cash/Bank
//   transfer    out  DR Transfer Clearing CR Cash/Bank(from)
//   transfer    in   DR Cash/Bank(to)    CR Transfer Clearing
//   reversal    in   DR Cash/Bank        CR (the reversed side)
//   reversal    out  DR (the reversed side) CR Cash/Bank
//   adjustment  in   DR Cash/Bank        CR Prior-Period Adjustments
//   adjustment  out  DR Prior-Period Adjustments CR Cash/Bank
//
// The transfer pair routes through a clearing account so that EACH LEG
// balances on its own. Posting one leg as a direct bank-to-bank pair would
// leave the first insert unbalanced until the second arrived, and any read
// in between (or a failure between them) would see broken books. The
// clearing account nets to zero once both legs land, which doubles as an
// integrity check: a non-zero clearing balance means a half-posted transfer.

const CASH_ROLE = 'cash';
const REVENUE_ROLE = 'contribution_revenue';
const EXPENSE_ROLE = 'general_expense';
const CLEARING_ROLE = 'transfer_clearing';
const ADJUSTMENT_ROLE = 'adjustment';

/**
 * Resolves a system-role account, seeding the template on first miss.
 *
 * The lazy seed is what lets this ship to churches that already exist: they
 * have no chart of accounts until something needs one, and the first
 * posting after deployment creates it rather than requiring a backfill
 * script to have been run first.
 */
async function resolveSystemAccount(tenantId, systemRole, connection) {
  let account = await chartOfAccountsRepository.findBySystemRole(tenantId, systemRole, connection);
  if (!account) {
    await chartOfAccountsRepository.seedTemplate(tenantId, connection);
    account = await chartOfAccountsRepository.findBySystemRole(tenantId, systemRole, connection);
  }
  if (!account) {
    // Only reachable if the template itself lost this role — a programming
    // error, not a data state, so it is loud rather than silently skipped.
    throw new AppError('INTERNAL_ERROR', `Chart of accounts is missing the "${systemRole}" system account`, {
      status: 500,
    });
  }
  return account;
}

// The asset side: the GL account explicitly mapped on the cash/bank account
// when a church has configured one, else the default Cash and Bank account.
async function resolveAssetAccountId(tenantId, account, connection) {
  if (account?.gl_account_id) return account.gl_account_id;
  return (await resolveSystemAccount(tenantId, CASH_ROLE, connection)).id;
}

// The income/expense side: the GL account mapped on the category, else the
// role default for the direction of the movement.
async function resolveCategoryAccountId(tenantId, category, fallbackRole, connection) {
  if (category?.gl_account_id) return category.gl_account_id;
  return (await resolveSystemAccount(tenantId, fallbackRole, connection)).id;
}

/**
 * Builds the DR/CR line pair for one transaction.
 *
 * `context` carries the already-loaded account/category rows from
 * postLedgerEntry's own validation, so this adds no extra lookups on the
 * hot path for the common case.
 */
async function buildLines(tenantId, transaction, context, connection) {
  const { amount, type, direction } = transaction;
  const assetId = await resolveAssetAccountId(tenantId, context.account, connection);
  const fundId = transaction.fund_id ?? null;
  const dr = (coaAccountId) => ({ coaAccountId, fundId, debit: amount, credit: '0.00' });
  const cr = (coaAccountId) => ({ coaAccountId, fundId, debit: '0.00', credit: amount });

  if (type === 'transfer') {
    const clearingId = (await resolveSystemAccount(tenantId, CLEARING_ROLE, connection)).id;
    return direction === 'out' ? [dr(clearingId), cr(assetId)] : [dr(assetId), cr(clearingId)];
  }

  if (type === 'adjustment') {
    const adjustmentId = (await resolveSystemAccount(tenantId, ADJUSTMENT_ROLE, connection)).id;
    return direction === 'in' ? [dr(assetId), cr(adjustmentId)] : [dr(adjustmentId), cr(assetId)];
  }

  // income, expense and reversal all pair the asset against a
  // revenue/expense account; only which side the asset sits on differs, and
  // that is exactly what `direction` already encodes. A reversal is
  // therefore handled by the same two lines as the entry it reverses, with
  // direction flipped by the caller — no separate reversal matrix to keep
  // in step.
  const isInflow = direction === 'in';
  const counterpartId = await resolveCategoryAccountId(
    tenantId,
    context.category,
    isInflow ? REVENUE_ROLE : EXPENSE_ROLE,
    connection
  );
  return isInflow ? [dr(assetId), cr(counterpartId)] : [dr(counterpartId), cr(assetId)];
}

/**
 * The balance assertion. Debits must equal credits to the cent, checked
 * with the decimal-string money helpers rather than Number arithmetic —
 * 0.1 + 0.2 !== 0.3 in binary floating point, and a GL that is one cent out
 * is a GL an auditor rejects.
 */
function assertBalanced(lines) {
  const totalDebit = lines.reduce((sum, line) => addMoney(sum, line.debit), '0.00');
  const totalCredit = lines.reduce((sum, line) => addMoney(sum, line.credit), '0.00');
  if (totalDebit !== totalCredit) {
    throw new AppError('INTERNAL_ERROR', `Unbalanced journal entry: debits ${totalDebit} vs credits ${totalCredit}`, {
      status: 500,
    });
  }
  return { totalDebit, totalCredit };
}

/**
 * Posts the journal entry mirroring a just-inserted transaction row.
 * Always called with the caller's connection — never opens its own.
 */
export async function postJournalEntry(connection, tenantId, transaction, context = {}) {
  const lines = await buildLines(tenantId, transaction, context, connection);
  assertBalanced(lines);

  const entry = await journalRepository.insertEntry(
    tenantId,
    {
      transaction_id: transaction.id,
      financial_period_id: transaction.financial_period_id,
      // The ledger's own posting date, not "now" — a transaction posted
      // today against yesterday's period must appear in the period it
      // belongs to.
      entry_date: (transaction.posted_at ?? nowSql()).slice(0, 10),
      memo: transaction.description ?? null,
    },
    connection
  );

  await journalRepository.insertLines(tenantId, entry.id, lines, connection);
  return entry;
}

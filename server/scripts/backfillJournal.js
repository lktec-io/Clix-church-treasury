// GENERAL LEDGER BACKFILL.
//
// The double-entry journal arrived in migration 0037, and that migration
// deliberately did not rewrite history: it created the tables and left them
// empty. Every transaction posted BEFORE 0037 was applied therefore exists in
// the `transactions` ledger (which every balance and report reads) but has no
// journal entry, so it is invisible to the trial balance. The same gap opens
// again for anything posted while 0037 is pending on a server running newer
// code.
//
// This replays those transactions through the SAME posting engine the live
// code uses (journal.service.js#postJournalEntry) — no second implementation
// of the posting matrix that could disagree with it — and writes the missing
// balanced pairs.
//
// SAFE TO RE-RUN. It only looks at transactions that have no journal entry,
// so a second run finds nothing to do. Each entry is written in its own
// transaction: an interrupted run leaves completed work committed and simply
// resumes where it stopped.
//
//   node scripts/backfillJournal.js --dry-run     report what is missing
//   node scripts/backfillJournal.js               write the missing entries
//   node scripts/backfillJournal.js --tenant 3    one tenant only
//
// Run it AFTER `npm run migrate`, and prefer a maintenance window: it takes
// the same row locks a live posting would.
import { pool, withTransaction } from '../src/config/db.js';
import { postJournalEntry } from '../src/modules/financial/journal.service.js';
import { accountsRepository } from '../src/modules/accounts/accounts.repository.js';
import { categoriesRepository } from '../src/modules/categories/categories.repository.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const tenantArgIndex = args.indexOf('--tenant');
const onlyTenantId = tenantArgIndex >= 0 ? Number(args[tenantArgIndex + 1]) : null;

// Posted rows only: a draft or rejected transaction has no place in the GL,
// and a reversal carries its own posted row that is picked up like any other.
async function findUnjournaled(connection) {
  const [rows] = await connection.query(
    `SELECT t.*
       FROM transactions t
       LEFT JOIN journal_entries je ON je.transaction_id = t.id AND je.tenant_id = t.tenant_id
      WHERE je.id IS NULL
        AND t.status = 'posted'
        ${onlyTenantId ? 'AND t.tenant_id = ?' : ''}
      ORDER BY t.tenant_id, t.id`,
    onlyTenantId ? [onlyTenantId] : []
  );
  return rows;
}

async function main() {
  const connection = await pool.getConnection();
  let pending;
  try {
    pending = await findUnjournaled(connection);
  } finally {
    connection.release();
  }

  if (pending.length === 0) {
    console.log('[backfill] every posted transaction already has a journal entry — nothing to do.');
    return;
  }

  const byTenant = new Map();
  for (const row of pending) byTenant.set(row.tenant_id, (byTenant.get(row.tenant_id) ?? 0) + 1);
  console.log(`[backfill] ${pending.length} posted transaction(s) have no journal entry:`);
  for (const [tenantId, count] of byTenant) console.log(`           tenant ${tenantId}: ${count}`);

  if (dryRun) {
    console.log('[backfill] --dry-run: nothing was written.');
    return;
  }

  let written = 0;
  const failures = [];
  for (const transaction of pending) {
    try {
      // One transaction per entry: the engine needs a connection, and a
      // failure on one row must not roll back the rows already fixed.
      await withTransaction(async (trx) => {
        // The engine reads the GL account explicitly mapped on the
        // account/category when the church configured one, so both are
        // loaded here exactly as postLedgerEntry does on the live path.
        const [account, category] = await Promise.all([
          accountsRepository.findById(transaction.tenant_id, transaction.account_id, trx),
          transaction.category_id
            ? categoriesRepository.findById(transaction.tenant_id, transaction.category_id, trx)
            : Promise.resolve(null),
        ]);
        await postJournalEntry(trx, transaction.tenant_id, transaction, { account, category });
      });
      written += 1;
      if (written % 100 === 0) console.log(`[backfill] ${written}/${pending.length}…`);
    } catch (error) {
      failures.push({ id: transaction.id, tenantId: transaction.tenant_id, message: error.message });
    }
  }

  console.log(`[backfill] wrote ${written} journal entr${written === 1 ? 'y' : 'ies'}.`);
  if (failures.length > 0) {
    console.error(`[backfill] ${failures.length} transaction(s) could NOT be journaled:`);
    for (const failure of failures) {
      console.error(`           tenant ${failure.tenantId} transaction ${failure.id}: ${failure.message}`);
    }
    console.error('[backfill] Those rows are unchanged. Fix the cause and run again — re-running is safe.');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`[backfill] failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

# Financial Architecture

**Governing principle:** the backend Financial Engine is the *only* source of truth for balances, totals, and report figures. No frontend screen, and no other backend module, computes a financial number independently. If two places in the product show a total, they call the same service.

This document is the most important one in the set — financial integrity is the product's entire value proposition. A treasury system that gets a balance wrong is not a buggy product, it is a failed one.

**Current state:** Phases 3–9 implemented — `server/src/modules/financial/financialEngine.service.js` is real, working code, and now has real consumers across the whole product: contributions (Phase 4), expenses (Phase 5), the transfers HTTP layer (Phase 6), pledge payments (Phase 7), budgets and period closing (Phase 8), and the reporting suite (Phase 9) all post through, or read from, this one engine — none of them with a parallel calculation of their own. §§1–8 below describe the actual implementation (deviations from the original design called out explicitly). Written and lint-clean; test suites (`tests/phase3/` through `tests/phase9/`) written but not yet run against a live database — see [MASTER_TODO.md](MASTER_TODO.md).

---

## 1. Transaction Model: Append-Only Ledger

Every financial event — income, an expense, a transfer, a correction — becomes a row in `transactions` ([DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §2), inserted exclusively by `financialEngine.service.js`'s internal `insertLedgerRow` — no other function in the codebase writes to this table, and no other module ever will (Phase 4+ domain modules call `recordSimpleTransaction`/`transfer`/`reverseTransaction`/`createAdjustment`, never their own SQL). This table is never updated or deleted once a row reaches `status = 'posted'`, with exactly one narrow exception: a transfer's two legs get their `reference_id` filled in immediately after both insert, to link them to each other — this never touches amount, direction, account, fund, or status, so it doesn't compromise the immutability guarantee (see the code comment at the call site for the full reasoning).

Domain tables (`contributions`, `expenses` — Phase 4/5, not yet built) will hold the human-facing detail (who, why, method) and link to the ledger row(s) they produce via `transactions.reference_type`/`reference_id`. **`transfers` is not planned as a separate table at all** — a transfer is fully represented as two linked `transactions` rows (see §3), which is a simplification from the original Phase 0 sketch.

**Why append-only instead of mutable balance fields:** a mutable `accounts.balance` column that gets incremented/decremented in place has no history — if it's ever wrong (bug, concurrent-write race, manual DB fix), there's no way to reconstruct how it got that way or to prove it's correct. An append-only ledger makes every balance a *derived, reproducible fact*: sum the rows, get the number, always. This is standard practice in accounting software for exactly this reason, and it directly serves the "financial integrity over convenience" requirement.

---

## 2. Balance Calculation

**Rule, as implemented (`transactions.repository.js#sumSigned`):**
```sql
SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS balance
FROM transactions WHERE tenant_id = ? AND status = 'posted' [AND account_id = ?] [AND fund_id = ?]
```
`financialEngine.service.js` exposes this as `getAccountBalance`, `getFundBalance`, and `getTotalBalance` (no filter = every account/fund in the tenant). The SUM is computed by MySQL over the `DECIMAL(14,2)` column and returned as a string — it is never coerced through a JS number, so the balance calculation itself cannot introduce a floating-point rounding error (see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §1).

- No account row stores a running balance as its source of truth — confirmed: the `accounts`/`funds` tables have no balance column at all.
- **Deviation from the original design:** the `direction` column (`in`/`out`) was added to `transactions` beyond the original Phase 0 schema — see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §6 for why `type` alone can't disambiguate a transfer's two legs.
- **Performance handling (closing-balance snapshot) was deliberately not built, even once Phase 8 (its originally-scoped home) was reached.** Every balance — including a financial period's opening/closing balance — is still computed live by summing the ledger (`sumSignedThroughPeriodDate`/`sumSignedThroughDate`), never cached or snapshotted. This was a conscious scope decision made while building Phase 8, not a gap: at this product's expected scale (individual churches, not enterprises), a live `SUM` over an indexed, tenant-scoped, date-bounded query set is fast enough that a cache would add invalidation complexity for no measurable benefit — exactly the kind of unneeded complexity the "keep it simple" brief for Phase 8 warned against building.

---

## 3. Fund Tracking

Funds (`funds` table) represent designated pools of money — "General Fund," "Building Fund," "Missions" — independent of which physical account holds the cash. Every ledger row carries both an `account_id` (where the money physically sits) and a `fund_id` (what it's designated for).

- `is_restricted` funds (e.g. a building campaign) must never be netted against unrestricted funds in a report without the report explicitly labeling the breakdown — a core expectation of church financial reporting is fund-level accountability, not just a single bottom-line number. (Reporting itself is Phase 9; the schema and engine already carry the `is_restricted` flag through every balance query.)
- **Transfers, as implemented (`financialEngine.service.js#transfer`):** a transfer posts exactly two `transactions` rows in one DB transaction — `type: 'transfer', direction: 'out'` on the source account/fund, and `type: 'transfer', direction: 'in'` on the destination, both carrying the same `amount`. Their `reference_id` columns point at each other, pairing the legs. Because the two legs are equal-and-opposite by construction, summing across every account in the tenant (`getTotalBalance`) cancels them out automatically — "a transfer must not change total church money" isn't a separate check the code performs, it's a structural consequence of how a transfer is built. Tested explicitly in `tests/phase3/financialEngine.test.js` and `tests/phase3/concurrency.test.js` (including under concurrent transfers).
- A transfer where source and destination are the exact same account *and* the exact same fund is rejected as a no-op (`VALIDATION_ERROR`) — moving money to itself isn't a transfer.
- A transfer where either leg references an invalid/inactive/cross-tenant account or fund rolls back **both** legs — proven by test (`tests/phase3/financialEngine.test.js` — "rolls back both legs if the destination account is invalid").

---

## 4. Transaction Immutability & Reversal Mechanism

**Rule, as implemented (`financialEngine.service.js#reverseTransaction`):** a posted transaction is never `UPDATE`d or `DELETE`d by application code except for the one sanctioned bookkeeping mutation below. If a posted transaction was recorded in error, the correction is a **new** row of `type = 'reversal'`, `direction` = the opposite of the original's, same `amount`/`account_id`/`fund_id`/`category_id`, linked via `reference_type: 'transactions'`/`reference_id: <original.id>`.

- The reversal service, atomically, in one DB transaction: (1) validates the original is `status = 'posted'` and not already reversed (`CONFLICT` if either fails — tested), (2) finds the tenant's current open financial period, (3) inserts the reversal row, (4) updates the original to `status = 'reversed'` and sets `reversed_by_transaction_id` — this update is the one sanctioned mutation of a posted row, and it never touches `amount`, `direction`, `account_id`, or `fund_id`.
- **A reversal always posts against the tenant's *current open* period, not the original transaction's period** — even if that period has since closed. You cannot post anything, including a correction, into a closed period; a reversal is dated (and accounted) today. Tested explicitly (`tests/phase3/financialEngine.test.js` — "a reversal posts against the current open period even if the original period is closed").
- A transaction can only be reversed once — reversing an already-reversed transaction is rejected with `CONFLICT`.
- **Adjustments** (`financialEngine.service.js#createAdjustment`) — a distinct `type = 'adjustment'`, not tied to a specific prior transaction (e.g. a bank reconciliation difference). A non-empty `description` (the reason) is required and enforced — an adjustment with no reason is rejected with `VALIDATION_ERROR`.
- No role, including an admin, has a "just edit the amount" path on a posted transaction — confirmed by the code itself: there is no update/edit function for a posted row's financial fields anywhere in `financialEngine.service.js`, and `TenantScopedRepository.update` is never called against `transactions` for anything other than the two sanctioned cases above (reversal linkage, transfer leg pairing).

---

## 5. Financial Period Closing

**Phase 3 built the enforcement primitive; Phase 8 delivered the full workflow on top of it.** As implemented in `financialPeriods.service.js` and `financialSummary.service.js`:

- A `financial_period` starts `open`. `assertPeriodOpenAndOwned` runs before every single ledger insert (`postLedgerEntry`, so every posting path — income, expense, transfer, reversal, adjustment — goes through it without exception) and rejects with `409 PERIOD_LOCKED` if the period is `closed` or doesn't belong to the tenant. Tested (`tests/phase3/financialEngine.test.js`, re-verified at the HTTP layer in `tests/phase8/financialPeriods.test.js`).
- `closePeriod(tenantId, periodId, userId)` sets `status = 'closed'`, `closed_by_user_id`, `closed_at`, and writes an audit log entry (`financial_period.closed`). `POST /financial-periods/:id/close` (Phase 8) exposes it over HTTP, gated by `financial_period.close`.
- `reopenPeriod(tenantId, periodId, userId, reason)` is audited (`financial_period.reopened`, with the reason recorded), gated by the separate, deliberately more restrictive `financial_period.reopen` permission (§3 of [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md)) — granted only to Super Administrator, not even to Treasurer, who can close but not reopen. `POST /financial-periods/:id/reopen` rejects with `422` if no reason is given.
- **Closing is a non-blocking checklist, not a hard gate.** `getClosingChecklist` surfaces pending-approval and approved-unpaid expense counts as *information*, but the only thing that actually blocks `close` is the period already being closed — there are no draft/pending ledger rows in this architecture (every posting is final on insert), so there is no other condition that could meaningfully block closing.
- **No closing-balance snapshot was built** — see §2 above. Opening/closing balance for a period is computed live via `sumSignedThroughPeriodDate`, joined against `financial_periods.start_date`/`end_date`, every time it's requested.

---

## 6. Reporting Must Not Recompute

Report generation (income statements, fund summaries, contribution exports) calls the **same aggregation services** the dashboard calls — a shared Financial Engine service layer, not bespoke SQL written per report. PDF/Excel/CSV generation (Phase 9) is purely a rendering step on top of that service's output.

This is what guarantees the dashboard total and the PDF report total can never silently drift apart — there is structurally only one code path that computes "fund balance," and every surface (dashboard widget, PDF, CSV, API response for a third party) is a view over it.

**As implemented (Phase 9):** all 9 reports in `reports.service.js` call an existing repository/service method — never new aggregation SQL. The Financial Summary report and Phase 8's closing summary call the literal same function, `financialSummary.service.js#getFinancialSummary`. While wiring this up, a real inconsistency was caught and fixed: `transactionsRepository.sumByType` (which produces report *totals*) did not accept the `accountId`/`dateFrom`/`dateTo` filters that `listHistory` (which produces report *rows*) did — meaning an account- or date-filtered Income/Expense report would have shown a total silently computed over a *different, unfiltered* row set than the rows displayed. `sumByType` was extended to accept the same filter set, closing that gap. This is exactly the class of bug this section exists to prevent, caught by keeping rows and totals flowing through comparable, symmetric filter logic rather than two independently-hand-maintained query shapes.

---

## 7. Pledges vs. Contributions

A pledge is a *commitment*, not money received — it never posts a ledger transaction on its own. Only the linked `contributions` (via `contributions.pledge_id`) post transactions. A pledge's "fulfilled amount" is always `SUM(contributions.amount WHERE pledge_id = ? AND status = 'posted')`, computed, not stored — same derived-not-mutable principle as account balances (§2), for the same reason.

**As implemented (Phase 7):** exactly as designed. `pledges.repository.js#getFulfilledAmount` is the one place fulfillment is computed; `pledges.service.js#withFulfillment` attaches `fulfilled_amount`/`remaining_amount` to every pledge response, never persisted on the row itself. A pledge payment is not a separate code path — it *is* a normal `contributions.service.js#recordContribution` call carrying an optional `pledgeId`, inside the same DB transaction as the ledger post and the receipt issuance, so a pledge payment cannot exist without an equally real contribution, ledger row, and receipt. Overpayment beyond the remaining balance is rejected (`422`); a payment against a `cancelled` pledge is rejected (`409`). Pledge status (`active`/`completed`/`cancelled`) is a flat enum with exactly one automatic transition (crossing the fulfillment threshold), not a general state machine — deliberately, per the Phase 7 brief's "do not create a complicated state machine unless the business actually requires it."

---

## 8. Approval Gating

**Implemented in Phase 5, as designed here.** An expense only posts a ledger transaction once it reaches `status = 'approved'` **and** the treasurer executes the separate `pay` action (`expenses.service.js#payExpense`) — `draft`, `submitted`, `approved`, and `rejected` all have zero ledger effect, verified by test at every state (`tests/phase5/expenses.test.js`). This is one step more explicit than this section originally sketched ("approved" alone was the trigger in the Phase 0 design); building the real workflow surfaced that "approved" and "money has actually left the account" are two different moments a treasurer needs to track separately (an approved-but-unpaid expense is still a real, distinct state), so `pay` was added as its own gated transition. Segregation of duties — the requester of an expense cannot be the one who approves it — is enforced in the same service function, independent of what permissions the requester otherwise holds.

**Contributions (Phase 4) do not have an approval gate** — income posts immediately on recording, matching how church treasuries record money received (no one needs to "approve" an offering before it counts). This asymmetry between income and expense gating was a genuine design decision made while building Phase 4, not an oversight: the original Phase 0 design didn't explicitly address whether income needed the same gating expenses do.

---

## 9. Status Against This Document

**Phase 3 delivered:** `transactions` table, the posting primitive (`postLedgerEntry` — private until Phase 4 needed it exported for composition, see below), `recordSimpleTransaction`, `transfer`, `reverseTransaction`, `createAdjustment`, and the reporting-foundation query methods — all in `server/src/modules/financial/financialEngine.service.js`. Money is handled as decimal strings end-to-end; every multi-row operation is one atomic DB transaction; duplicate transaction numbers are structurally prevented; concurrency is handled by the append-only design itself (`tests/phase3/concurrency.test.js`).

**Phase 4–6 delivered — the engine now has real consumers, proving §1's governing principle rather than just stating it:**
- `postLedgerEntry` was **exported** from `financialEngine.service.js` (previously module-private) specifically so a domain module can open its own DB transaction, insert its own domain row, and post the ledger entry in the same atomic unit — the same composition pattern `tenants.service.js`'s `createTenantWithConnection` established in Phase 1/2. `contributions.service.js#recordContribution` and `expenses.service.js#payExpense` both use this; neither writes to `transactions` any other way.
- `contributions.reverseContribution` and `expenses`' financial-effect posting both call the exact same reversal/posting logic the engine's own `reverseTransaction`/`transfer` use — confirmed by code review, not just by convention: there is one reversal code path and one posting code path in the entire codebase.
- The `direction` column decision (§2, [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §6) held up unchanged through six more phases of real usage — no further schema deviation was needed to model income, expenses, pledges, receipts, budgets, or reports.

**Phase 7 delivered:** pledges as commitments-only, fulfillment derived from posted contributions (§7); receipts issued atomically alongside every contribution, server-generated tenant-scoped sequential numbering; a storage-service *contract* for future attachment upload (Cloudinary itself was not provisioned this session — every method throws `501 STORAGE_NOT_CONFIGURED`, documented as PENDING, not silently stubbed).

**Phase 8 delivered:** budgets (plan vs. actual, actual always sourced from `sumByType`, §6); the full close/reopen HTTP workflow (§5) — deliberately without a closing-balance snapshot (§2), since every balance in this architecture is already derived live.

**Phase 9 delivered:** exactly 9 reports, all composing existing Financial Engine/domain-service methods (§6); reusable PDF/Excel/CSV export infrastructure shared by all 9, not one exporter per report; the `sumByType` filter-parity fix described in §6.

**Not yet verified:** written and lint-clean, build succeeds, and every new/changed module was confirmed to import without error — but none of this has run against a live MySQL instance — see [MASTER_TODO.md](MASTER_TODO.md) for the blocker. "Delivered" above describes the code as written, not a passing live test run.

**Remaining, unchanged from the original plan:** none — Phases 3 through 9, the full financial domain originally scoped across this document, are now implemented. Phases 10–12 (dashboard/UX polish, audit hardening, production deployment) are the only work left, and none of it involves a new financial calculation.

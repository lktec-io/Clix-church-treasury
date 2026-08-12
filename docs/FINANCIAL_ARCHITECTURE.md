# Financial Architecture

**Governing principle:** the backend Financial Engine is the *only* source of truth for balances, totals, and report figures. No frontend screen, and no other backend module, computes a financial number independently. If two places in the product show a total, they call the same service.

This document is the most important one in the set — financial integrity is the product's entire value proposition. A treasury system that gets a balance wrong is not a buggy product, it is a failed one.

**Current state:** Phases 3–6 implemented — `server/src/modules/financial/financialEngine.service.js` is real, working code, and now has real consumers: contributions (Phase 4), expenses (Phase 5), and the transfers HTTP layer (Phase 6) all post through it, none of them with a parallel calculation of their own. §§1–5 below describe the actual implementation (deviations from the original design called out explicitly); §7 (pledges) and §8-as-approval-gating are now proven, not just designed — see the note at the end of each section. Written and lint-clean; test suites (`tests/phase3/` through `tests/phase6/`) written but not yet run against a live database — see [MASTER_TODO.md](MASTER_TODO.md).

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
- **Deviation from the original design:** the `direction` column (`in`/`out`) was added to `transactions` beyond the original Phase 0 schema — see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §7 for why `type` alone can't disambiguate a transfer's two legs.
- **Performance handling (closing-balance snapshot) is not yet built.** Phase 3 always sums the full ledger; the snapshot-and-cache optimization described in the original design is real future work, correctly scoped to Phase 8 (Budget + Financial Closing) where the full closing workflow lives. Not a regression — Phase 3's job was the correctness of the derivation, not its performance at scale.

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

**Phase 3 built the enforcement primitive; Phase 8 builds the full workflow.** As implemented in `financialPeriods.service.js`:

- A `financial_period` starts `open`. `assertPeriodOpenAndOwned` runs before every single ledger insert (`insertLedgerRow`, so every posting path — income, expense, transfer, reversal, adjustment — goes through it without exception) and rejects with `409 PERIOD_LOCKED` if the period is `closed` or doesn't belong to the tenant. Tested (`tests/phase3/financialEngine.test.js`).
- `closePeriod(tenantId, periodId, userId)` sets `status = 'closed'`, `closed_by_user_id`, `closed_at`, and writes an audit log entry (`financial_period.closed`) — already real and tested.
- `reopenPeriod(tenantId, periodId, userId, reason)` exists and is audited (`financial_period.reopened`, with the reason recorded), using the separate `financial_period.reopen` permission (§3 of [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md)) rather than `financial_period.close`.
- **Not yet built (Phase 8 scope, as originally planned):** the `closing_balance` snapshot computation (§2), and any HTTP route/permission-gated endpoint to trigger close/reopen — the Phase 3 service functions exist and are tested directly, but nothing calls them over HTTP yet. This is intentional scoping, not an oversight: Phase 3's job was proving the ledger *respects* period state, not building the operator-facing closing workflow.

---

## 6. Reporting Must Not Recompute

Report generation (income statements, fund summaries, contribution exports) calls the **same aggregation services** the dashboard calls — a shared Financial Engine service layer (e.g. `financialEngine.getFundSummary(tenantId, periodId)`), not bespoke SQL written per report. PDF/Excel/CSV generation (Phase 9) is purely a rendering step on top of that service's output.

This is what guarantees the dashboard total and the PDF report total can never silently drift apart — there is structurally only one code path that computes "fund balance," and every surface (dashboard widget, PDF, CSV, API response for a third party) is a view over it.

---

## 7. Pledges vs. Contributions

A pledge is a *commitment*, not money received — it never posts a ledger transaction on its own. Only the linked `contributions` (via `contributions.pledge_id`) post transactions. A pledge's "fulfilled amount" is always `SUM(contributions.amount WHERE pledge_id = ?)`, computed, not stored — same derived-not-mutable principle as account balances (§2), for the same reason.

*Not yet built — `pledges` doesn't exist until Phase 7.* What Phase 4 did build, matching this section's underlying principle: `contributions.amount`/`status` are documented as denormalized-for-listing copies of the linked `transactions` row, never independently editable — the same "never store what can be derived, and never let a copy drift from its source" discipline this section describes for pledges.

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
- The `direction` column decision (§2, [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §7) held up unchanged through three more phases of real usage — no further schema deviation was needed to model income, expenses, or the domain-level detail around them.

**Not yet verified:** written and lint-clean, but not yet run against a live MySQL instance — see [MASTER_TODO.md](MASTER_TODO.md) for the blocker. "Delivered" above describes the code as written, not a passing test run.

**Remaining, unchanged from the original plan:**
- Phase 4–7: each domain module (contributions, expenses, pledges) posts through this engine, never writes its own ledger-adjacent SQL. No HTTP routes for income/expense recording exist yet — Phase 3 deliberately built the engine with no consumer yet.
- Phase 8: the closing-balance snapshot (§2), the HTTP close/reopen endpoints (§5), budget-vs-actual.
- Phase 9: report renderers strictly on top of these Financial Engine services (§6), never their own SQL.

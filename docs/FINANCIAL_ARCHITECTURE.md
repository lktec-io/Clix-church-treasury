# Financial Architecture

**Governing principle:** the backend Financial Engine is the *only* source of truth for balances, totals, and report figures. No frontend screen, and no other backend module, computes a financial number independently. If two places in the product show a total, they call the same service.

This document is the most important one in the set — financial integrity is the product's entire value proposition. A treasury system that gets a balance wrong is not a buggy product, it is a failed one.

---

## 1. Transaction Model: Append-Only Ledger

Every financial event — a contribution recorded, an expense approved, a transfer executed, a correction — becomes a row in `transactions` ([DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §2). This table is never updated or deleted once a row reaches `status = posted`.

Domain tables (`contributions`, `expenses`, `transfers`) hold the human-facing detail (who, why, method) and each link to the ledger row(s) they produced via `transaction_id`. The domain table can be edited *before* posting (a draft expense request can be corrected); once posted, both the domain row and its ledger row are frozen.

**Why append-only instead of mutable balance fields:** a mutable `accounts.balance` column that gets incremented/decremented in place has no history — if it's ever wrong (bug, concurrent-write race, manual DB fix), there's no way to reconstruct how it got that way or to prove it's correct. An append-only ledger makes every balance a *derived, reproducible fact*: sum the rows, get the number, always. This is standard practice in accounting software for exactly this reason, and it directly serves the "financial integrity over convenience" requirement.

---

## 2. Balance Calculation

**Rule:** `account balance = SUM(transactions.amount, signed by type) WHERE tenant_id = ? AND account_id = ? AND status = 'posted'`.

- No account row stores a running balance as its source of truth.
- **Performance handling:** for tenants with years of history, summing from row one on every dashboard load doesn't scale. Once a `financial_period` is `closed` (§5), its ending balance is computed once and cached as a `closing_balance` snapshot on the period record. Live balance for the *current open* period = closed-period snapshot + sum of that period's posted transactions. This keeps the derived-balance guarantee while bounding the live query to one period's worth of rows.
- The snapshot is a cache, not a second source of truth — if ever in doubt, it must be reproducible by re-summing the ledger. Phase 8 (Budget + Financial Closing) includes a reconciliation job/endpoint that does exactly this, for support/debugging use.

---

## 3. Fund Tracking

Funds (`funds` table) represent designated pools of money — "General Fund," "Building Fund," "Missions" — independent of which physical account holds the cash. Every ledger row carries both an `account_id` (where the money physically sits) and a `fund_id` (what it's designated for).

- `is_restricted` funds (e.g. a building campaign) must never be netted against unrestricted funds in a report without the report explicitly labeling the breakdown — a core expectation of church financial reporting is fund-level accountability, not just a single bottom-line number.
- A transfer between funds within the same account moves money between fund designations without moving it between bank accounts — it still posts two ledger rows (a fund-out, a fund-in), because the ledger is the record of *every* designation change, not just cash movement.

---

## 4. Transaction Immutability & Reversal Mechanism

**Rule:** a posted transaction is never `UPDATE`d or `DELETE`d by application code. If a posted expense was recorded in error, the correction is a **new** transaction of `type = 'reversal'` that references the original via `reversed_by_transaction_id`, with an equal and opposite amount.

- The original row stays intact, visible, and linked — anyone auditing the books later sees both the mistake and its correction, with who reversed it and when (via the standard `created_by_user_id` + [audit log](SECURITY_ARCHITECTURE.md) §7).
- A `status = 'reversed'` flag on the original marks it as superseded for reporting purposes (excluded from "current" balance calculations by being netted against its reversal — both rows remain in the sum, so the net effect is zero, which is mathematically identical to deletion without losing the record).
- **Adjustments** (correcting an amount without claiming the original was wrong — e.g. a bank reconciliation difference) use `type = 'adjustment'`, a distinct type from `reversal`, so reports can distinguish "we made an error and fixed it" from "the bank statement didn't match and we adjusted to it."
- No role, including an admin, gets a "just edit the amount" UI path on a posted transaction. This is enforced at the service layer, not just hidden in the UI — the API endpoint for editing a posted transaction's amount/account/fund simply does not exist.

---

## 5. Financial Period Closing

- A `financial_period` (e.g. a quarter or fiscal year, per church settings) starts `open`. While open, transactions post freely against it.
- **Closing** a period (`POST /financial-periods/:id/close`, permission-gated, e.g. `period.close`) does three things atomically: (1) computes and stores the `closing_balance` snapshot per account/fund (§2), (2) sets `status = closed`, (3) writes an audit log entry.
- While `closed`, no new transaction may post with that `financial_period_id` — any attempt returns `PERIOD_LOCKED` ([API_ARCHITECTURE.md](API_ARCHITECTURE.md) §4). This is what makes a closed period a real financial close, not a UI label.
- **Reopening** a closed period is possible but requires an elevated permission (distinct from `period.close`, e.g. `period.reopen`) and is itself an audited event with a required reason/comment — reopening a closed financial period is rare and consequential enough that the product should make it deliberately friction-ful, not a casual toggle.

---

## 6. Reporting Must Not Recompute

Report generation (income statements, fund summaries, contribution exports) calls the **same aggregation services** the dashboard calls — a shared Financial Engine service layer (e.g. `financialEngine.getFundSummary(tenantId, periodId)`), not bespoke SQL written per report. PDF/Excel/CSV generation (Phase 9) is purely a rendering step on top of that service's output.

This is what guarantees the dashboard total and the PDF report total can never silently drift apart — there is structurally only one code path that computes "fund balance," and every surface (dashboard widget, PDF, CSV, API response for a third party) is a view over it.

---

## 7. Pledges vs. Contributions

A pledge is a *commitment*, not money received — it never posts a ledger transaction on its own. Only the linked `contributions` (via `contributions.pledge_id`) post transactions. A pledge's "fulfilled amount" is always `SUM(contributions.amount WHERE pledge_id = ?)`, computed, not stored — same derived-not-mutable principle as account balances (§2), for the same reason.

---

## 8. Approval Gating

An expense only posts a ledger transaction once it reaches `status = approved` (after passing its `expense_approvals` chain — see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §2). A `draft` or `pending_approval` expense is visible in the UI as a pending item but contributes nothing to any balance or report total. This means "money isn't spent, as far as the books are concerned, until someone with authority says it is" — matching how church treasuries actually expect approvals to work.

---

## 9. What Later Phases Must Deliver Against This Document

- Phase 3 (Financial Engine): the `transactions` table, the posting service (the single function every domain module calls to create ledger rows), the balance-calculation service, the reversal service. This phase must exist and be tested *before* Phase 4/5/6 domain modules are built on top of it — those phases should have nothing to build financial correctness logic themselves, only to call into Phase 3's engine.
- Phase 4–7: each domain module posts through the Phase 3 engine, never writes its own ledger-adjacent SQL.
- Phase 8: period closing/reopening, budget-vs-actual (budgets compare planned vs. `SUM(transactions)` for a category/fund/period — again, derived).
- Phase 9: report renderers strictly on top of Financial Engine services (§6).
- Testing (every phase touching money): unit tests asserting balance = sum of ledger, reversal nets to zero, closed-period posting is rejected, pledge fulfillment matches linked contributions.

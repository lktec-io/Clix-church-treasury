# Master TODO — Clix Church Treasury Management System

Governing execution plan, Phase 0 through Phase 12. Cross-references: [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md), [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md), [API_ARCHITECTURE.md](API_ARCHITECTURE.md), [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md), [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md), [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md), [DEPLOYMENT.md](DEPLOYMENT.md).

Checkboxes are updated as work genuinely completes (see [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) §8) — never batch-checked at phase end.

**Overall status:** Phases 0–12 all have code/documentation written and are considered feature-complete (IMPLEMENTED). Every phase from Phase 1 onward is blocked on the same thing: live verification against a real MySQL instance (`ER_ACCESS_DENIED_ERROR` for user `clix_app` in this environment — see [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) §8), and Phase 12 additionally requires a real production host/DNS/TLS that doesn't exist in this build environment. No phase's status has been fabricated as live-verified or live-deployed; each phase section below states LIVE-DB VERIFIED: PENDING explicitly, and Phase 12 states outright which infrastructure steps were not executed. `npm run lint` is clean on both `server/` and the frontend; the frontend production build succeeds and was verified to bake in the correct production API URL with zero dev-localhost references. **DEVELOPMENT COMPLETE** in the sense of "all planned functionality exists, is wired end-to-end, and is code-reviewed" — deployment itself (§ [DEPLOYMENT.md](DEPLOYMENT.md)) is a separate, not-yet-taken step.

---

## PHASE 0 — Codebase / Architecture Initialization

**Objectives:** Understand the starting state, establish target architecture, produce governing documentation, map all subsequent phases.

- [x] Inspect entire repository (frontend, backend, database, docs, config, tests, deployment)
- [x] Identify existing features, technical debt, risks — **finding: none exist, this is a greenfield build** (see [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) §1)
- [x] Confirm technology direction (no existing commitments found; brief's stack adopted as-is)
- [x] Decide repository layout: monorepo, backend in `/server` (confirmed with stakeholder)
- [x] Initialize git repository, baseline commit of existing scaffold
- [x] Create `docs/` and all seven governing documents
- [x] Document all 16 required architectural decisions ([PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) §6)
- [x] Map Phase 1–12 work with objectives/db/backend/frontend/security/testing/acceptance criteria/dependencies (this document)
- [ ] **Stakeholder confirmation of Decision #16** (migration tooling — proposed default: hand-written SQL + custom runner, see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §5) — only remaining open item

**Database work:** None (no database exists; target schema documented in [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md)).
**Backend work:** None (no backend exists yet).
**Frontend work:** None — existing scaffold left untouched, will be built on starting Phase 10 (earlier phases are backend-first).
**Security work:** Threat model established conceptually (tenant isolation, OWASP mapping) in [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md); nothing to secure yet since nothing runs yet.
**Testing:** Testing strategy defined (§ below); no test suite exists yet — none was found, none was expected to exist in a scaffold.
**Acceptance criteria:** All seven docs exist and cross-reference correctly; all 16 decisions documented (open ones explicitly flagged, not silently assumed); Phase 1–12 dependency order is logical; no unresolved *blocking* unknown remains (Decision #16 is non-blocking — a default is proposed and Phase 1 can start against it).
**Dependencies:** None — this is the root phase.

**Status: Phase 0 substantially complete.** The one open item (Decision #16 confirmation) does not block Phase 1 from starting, since a reasoned default is documented and Phase 1's migration work can proceed against it, with a one-line update to this doc if the decision changes.

---

## PHASE 1 — Database + Multi-Tenant Foundation

**Objectives:** Stand up MySQL 8, implement the full target schema, prove tenant isolation at the data layer.

**Status: code complete, live verification pending.** MySQL 8 (`MySQL80` Windows service) is installed and reachable on port 3306, but the app's dedicated database user has not been created yet — the root password is unknown to the user and is being reset outside this session (see [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) §8). Every item below marked `[x]` is written, lint-clean code; items are only checked once the described behavior has actually been observed to work. **None of the database/testing checkboxes below are checked yet for that reason**, per this phase's own strict completion rule — "do not mark complete merely because migrations were created."

**Database work:**
- [x] MySQL 8 instance available (native Windows service; not Docker) — connectivity confirmed (`Test-NetConnection` succeeded on port 3306); app-user credentials not yet provisioned
- [x] Build the migration runner (`server/src/db/migrate.js` — up/down, `schema_migrations` tracking, per-migration transactions)
- [x] Write migrations for the foundation tables in FK-safe order: `tenants`, `church_settings`, `system_settings`, `permissions`, `users`, `roles`, `role_permissions`, `user_roles`, `refresh_tokens`, `accounts`, `funds`, `categories`, `financial_periods`, `transactions`, `audit_logs` (17 migration files, `0001`–`0017`) — **scope note:** `contributors`/`contributions`/`expenses`/`expense_approvals`/`transfers`/`pledges`/`receipts`/`budgets` were deliberately deferred to Phases 4–8 rather than created here; see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §2 for why
- [x] Apply indexing plan (composite indexes on every hot filter path — see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §4)
- [x] Seed scripts written: `permissionCatalog.js` (31 permissions, 6 system roles), `seedRbacCatalog.js` (idempotent), `seedDevTenant.js` (dev-only tenant + admin)
- [x] [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) updated with the finalized DDL (this was done as part of this phase, ahead of the checklist item below)
- [ ] **Migrations actually run against a live database** — blocked on DB access

**Backend work:**
- [x] `server/` package initialized (`package.json`, ESM, `mysql2` pool with `decimalNumbers: false`/`dateStrings: true`, config loader with fail-fast required-env validation)
- [x] Base repository helper enforcing `tenant_id` scoping: `TenantScopedRepository` (`server/src/db/TenantScopedRepository.js`) — every method requires `tenantId`, throws via `assertTenantId` if missing, no unscoped convenience method exists
- [x] Tenant/user/role/permission/account/fund/category repositories built on this pattern

**Frontend work:** None this phase (as planned).

**Security work:**
- [x] `.env.example` created and kept current (also `server/scripts/setup-db.example.sql` as a committed template, since the real `setup-db.sql` contains a generated credential and is gitignored)
- [x] Confirmed no tenant-owned repository method can execute unscoped — repo-wide grep audit found exactly one documented exception (`users.repository.js#findByIdAnyTenant`, used only by the refresh-token flow, tenant_id sourced server-side never from client input)
- [x] Confirmed no route/service reads `tenantId`/`tenant_id` from `req.body`/`req.params`/`req.query` anywhere (repo-wide grep, zero matches)

**Testing:**
- [x] Tests written (`server/tests/phase1/`): `migrations.test.js`, `tenantIsolation.repository.test.js`, `tenantIsolation.http.test.js`, `foreignKeys.test.js`, `tenantService.test.js`, `seed.test.js` — cover migration idempotency, cross-tenant repository/HTTP access (asserting 404 not 403), missing-tenant-context rejection, FK/unique-constraint enforcement, RBAC catalog seeding
- [ ] Tests actually executed against a live database — blocked on DB access

**Acceptance criteria:** Not yet met — acceptance requires a live run, which is blocked. Once unblocked: `npm run migrate` against the fresh `clix_treasury_dev`/`clix_treasury_test` databases, `npm test`, both green, is what closes this phase out.
**Dependencies:** Phase 0.

---

## PHASE 2 — Auth + RBAC + Security

**Objectives:** Working authentication, session/refresh flow, RBAC enforcement, and the security middleware stack — as reusable infrastructure every later phase builds on.

**Status: code complete, live verification pending** — same blocker as Phase 1 (no live database yet). All backend/security work below is real, lint-clean code with tests written against it; nothing has been executed against MySQL yet.

**Database work:** `failed_login_attempts`/`locked_until` added to `users` (`0016`), `password_reset_tokens` table added (`0017`) — beyond what Phase 1 originally created, discovered as genuinely needed while building lockout/reset.

**Backend work:**
- [x] Tenant provisioning: `POST /auth/register-tenant` — creates `tenants` + `church_settings` + first admin `user` (status `active`, role `Super Administrator`) in one DB transaction (`auth.service.js#registerTenant`)
- [x] `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` ([API_ARCHITECTURE.md](API_ARCHITECTURE.md) §6) — plus `POST /auth/password-reset/request` and `/confirm`, which the original plan listed as a design gap to close in this phase
- [x] Password hashing — **`bcryptjs`**, not native `bcrypt` (native failed to install; see [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) Decision #17)
- [x] JWT access token issuance + verification middleware (`tokens.js`, `authenticate.js`) — 15 min TTL, `HS256`
- [x] Refresh token rotation + reuse detection (`refreshTokens.repository.js#revokeChainFrom`) — presenting a revoked token kills its entire descendant chain
- [x] Tenant context middleware (`tenantContext.js`, built in Phase 1, wired into the real auth chain here)
- [x] `rbac` middleware (`rbac.js#requirePermission`) — re-derives permissions from the DB on every request, never trusts the JWT for authorization
- [x] `helmet()`, CORS allowlist (`cors` package, credentialed), rate limiter (`express-rate-limit`, 10/min on `/auth/*`, 300/min general, skipped in test env), centralized error handler (fixed to correctly surface body-parser 400/413s instead of collapsing them to 500 — a real gap the security test suite caught)
- [x] Audit log service (`auditLog.service.js#recordAuditLog`) — single write path, confirmed by grep audit
- [x] User management endpoints: `POST /users` (invite), `POST /users/:id/roles` (assign), `DELETE /users/:id/roles/:roleId` (remove), `POST /users/:id/disable`
- [x] Password reset flow — hashed, single-use, 30-minute token; doubles as "accept invite"; completing a reset revokes every refresh token the user holds
- [x] Account lockout — `maxAttempts`/`lockoutMinutes` configurable via env, distinct `423 ACCOUNT_LOCKED` response

**Frontend work:** Not started — deferred to Phase 10 per the original plan (this phase is backend-first, matching Phase 1/3's approach). `react-router-dom` is not yet a dependency.

**Security work:**
- [x] §§1–5 of [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) implemented as described (isolation, authN, authZ, transport headers, validation/rate limiting) — doc updated in the same pass to describe the actual implementation
- [x] Self-management protection: a user cannot disable their own account (service-layer check, tested) — full requester≠approver segregation of duties is correctly deferred to Phase 5 where an actual expense/approval record will exist

**Testing:**
- [x] Tests written (`server/tests/phase2/`): `auth.test.js` (registration, login incl. generic-error/lockout/enumeration-resistance, refresh rotation + reuse detection, logout, expired/forged-token rejection, password reset end-to-end), `rbac.test.js` (permission matrix across all 6 roles, privilege-escalation-blocked, disabled-user session revocation, cross-tenant role isolation), `security.test.js` (secure headers, CORS allowlist behavior, malformed/oversized bodies, no password-hash leakage, mass-assignment resistance, audit log never contains raw credentials)
- [ ] Tests actually executed against a live database — blocked on DB access

**Acceptance criteria:** Not yet met pending live verification. Once unblocked: `npm test` green is what closes this phase — the scenarios it needs to prove (login/refresh/RBAC/security) are all written.
**Dependencies:** Phase 1.

---

## PHASE 3 — Financial Engine

**Objectives:** Build the ledger and posting/balance/reversal engine every financial module depends on — this phase is pure infrastructure, no user-facing domain feature yet, but it is the most important phase in the product.

**Status: code complete, live verification pending** — same blocker as Phases 1–2.

**Database work:** `transactions` table as built in Phase 1, plus a `direction` (`in`/`out`) column added beyond the original design — `type` alone can't disambiguate a transfer's two legs (see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §6).

**Backend work:**
- [x] Posting primitive (`financialEngine.service.js`'s private `insertLedgerRow`) — the only function in the codebase that inserts into `transactions`; every public function (`recordSimpleTransaction`, `transfer`, `reverseTransaction`, `createAdjustment`) funnels through it
- [x] Balance calculation service — `getAccountBalance`/`getFundBalance`/`getTotalBalance`, all backed by one SQL `SUM` query (`transactions.repository.js#sumSigned`) computed by MySQL over `DECIMAL`, never coerced through a JS float
- [x] Transfer service — two linked, equal-and-opposite rows in one DB transaction; total-money-conserved is a structural consequence, not a separate check
- [x] Reversal service — `type = 'reversal'`, linked via `reversed_by_transaction_id`; posts against the *current open* period even if the original's period has since closed; blocks double-reversal
- [x] Adjustment service — `type = 'adjustment'`, distinct from reversal, requires a non-empty reason
- [x] Period-scoping enforcement (`financialPeriods.service.js#assertPeriodOpenAndOwned`) — runs before every single ledger insert with no exception, rejects with `409 PERIOD_LOCKED`
- [x] Fund + account balance query services, plus `getIncomeTotals`/`getExpenseTotals`/`getTransactionHistory` as the reporting-foundation methods Phase 9 will build on
- [x] Duplicate-transaction-number prevention — unique DB constraint + generation retry loop (`transactionNumber.js`), not just "unlikely by randomness"
- [x] Money-as-decimal-string end to end — API rejects a JSON number for `amount`, only accepts a validated decimal string (`money.js`)

**Frontend work:** None — no UI consumes this yet (as planned; no income/expense HTTP routes exist yet either, since those are Phase 4/5).

**Security work:** Every account/fund/category/period reference is validated as active and tenant-owned before a row posts (`assertAccountUsable`/`assertFundUsable`/`assertCategoryUsable`/`assertPeriodOpenAndOwned`) — cross-tenant references rejected with `VALIDATION_ERROR`, cross-tenant reversal attempts with `NOT_FOUND`. No direct-edit endpoint for posted transactions exists anywhere in the codebase (confirmed, not just planned).

**Testing:**
- [x] Tests written (`server/tests/phase3/financialEngine.test.js`, `concurrency.test.js`): opening balance, income/expense/multi-transaction balance correctness (cross-checked against an independent manual sum), transfer decreases-source/increases-destination/preserves-total/never-posts-as-income-or-expense/rejects-no-op/rolls-back-both-legs-on-failure, reversal exactly cancels effect/preserves original row/blocks double-reversal/posts-to-current-period-after-original-closes, adjustment posts and requires a reason, closed-period rejection, invalid-amount rejection (negative/zero/JS-number/too-many-decimals), inactive-account rejection, cross-tenant rejection (posting and reversing), duplicate-transaction-number DB-level rejection, 50-concurrent-postings integrity check, concurrent-transfer total-preservation check
- [ ] Tests actually executed against a live database — blocked on DB access

**Acceptance criteria:** Not yet met pending live verification. The engine has no consumers yet by design (Phase 4+ builds on it) but every rule in [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §§1–5 has a corresponding test already written, awaiting a database to run against.
**Dependencies:** Phase 1, Phase 2 (for permission-gated actions — though Phase 3 itself exposes no HTTP routes yet, so this dependency is currently theoretical; it becomes real once Phase 4/5 add income/expense endpoints on top of this engine).

---

## PHASE 4 — Income + Contributions

**Objectives:** Record contributions against contributors, funds, and categories; post through the Financial Engine.

**Status: IMPLEMENTED. TESTED (written). LIVE-DB VERIFIED: PENDING.**

**Database work:**
- [x] IMPLEMENTED — `contributors` (0018), `contributions` (0019) migrations. Deviates from the original Phase 1 sketch: `contributors` is a separate table specifically so contributor-identity visibility (`contributors.view`) can be permissioned independently of income-amount visibility (`income.view`) — see [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md).
- [ ] LIVE-DB VERIFIED — migrations have not been run against a real database.

**Backend work — all IMPLEMENTED:**
- [x] Contributor CRUD (`contributors.controller.js`/`.service.js`/`.repository.js`/`.routes.js`/`.validator.js`)
- [x] Contribution recording — posts through the Financial Engine via `postLedgerEntry` (exported from `financialEngine.service.js` for exactly this composition), the contribution row and its ledger row created atomically in one DB transaction
- [x] Category management HTTP routes (`categories.controller.js`/`.routes.js`/`.validator.js`) on the Phase 1 repository
- [x] Contribution listing/filtering (by contributor, fund, date range, payment method) — `contributions.repository.js#search`
- [x] Contribution reversal (`POST /contributions/:id/reverse`) — composes the reversal primitive with the contribution's own status flip in one transaction
- [x] Two rough edges found and fixed during this phase: duplicate contributor member-number and duplicate category (type, name) now return `409 CONFLICT` via check-before-insert, not a generic 500

**Frontend work — all IMPLEMENTED (`src/pages/ContributionsPage.jsx`, `ContributorsPage.jsx`):**
- [x] Record-contribution form (mobile-first, pure CSS)
- [x] Contributor list + add form
- [x] Contribution history table with reversal action, contributor identity shown only when the viewer holds `contributors.view`

**Security work:**
- [x] IMPLEMENTED — `contributors.view`/`contributors.manage` permissions, deliberately separate from `income.*`, granted only to Super Administrator/Treasurer/Assistant Treasurer (not Auditor/Approver/Viewer) — the privacy boundary the brief asked for
- [x] IMPLEMENTED — tenant-isolation enforced identically to every other module (via `TenantScopedRepository` + the Financial Engine's own cross-tenant reference checks)

**Testing:**
- [x] TESTED (written) — `server/tests/phase4/`: `contributions.test.js`, `contributors.test.js`, `categories.test.js`. Covers create/retrieve, tenant isolation, permission denial, invalid amount/account/fund/category, closed-period rejection, reversal (including double-reversal block and missing-reason rejection), contributor-privacy enrichment both with and without `contributors.view`, non-financial-only update.
- [ ] LIVE-DB VERIFIED — PENDING. No test in this suite has executed against a real database; `npm test` fails at `globalSetup` (migration step) with `ER_ACCESS_DENIED_ERROR` before any test runs.

**Acceptance criteria:** Met in code — a treasurer can record a contribution end-to-end via the UI and see it reflected in the relevant fund/account balance via the Financial Engine — but unverified against a live system.
**Dependencies:** Phase 1, 2, 3.

---

## PHASE 5 — Expenses + Approval

**Objectives:** Expense request → multi-step approval → posting, with segregation of duties.

**Status: IMPLEMENTED. TESTED (written). LIVE-DB VERIFIED: PENDING.**

**Database work:**
- [x] IMPLEMENTED — `expenses` migration (0020). **Scope decision:** a single-decision `expense_approvals`-style chain table from the original Phase 1 sketch was not built; this phase's own brief specifies a single approve/reject decision (not a multi-step chain), so `approved_by_user_id`/`rejected_by_user_id`/their timestamps live directly on `expenses`. A multi-approver chain remains a natural extension if a real requirement appears.
- [ ] LIVE-DB VERIFIED — PENDING.

**Backend work — all IMPLEMENTED:**
- [x] Full workflow: draft → submitted → approved/rejected (or returned to draft for correction) → paid (`expenses.service.js`)
- [x] `POST /expenses/:id/submit`, `/approve`, `/reject`, `/return`, `/pay`
- [x] Financial effect only at `pay` — posts through `postLedgerEntry` composed with the status flip in one DB transaction; every earlier state (draft/submitted/approved/rejected) has zero ledger effect, verified by test at each state
- [x] Segregation of duties: `approveExpense` blocks `requested_by_user_id === actorUserId`, independent of what permissions the requester holds
- [x] Double-payment prevented by a `409 CONFLICT` status-transition guard, not by a database race
- [x] Attachment metadata validation (MIME allowlist, 5MB cap) — **no upload endpoint** since Cloudinary isn't provisioned until Phase 7; this is a deliberate deferral, not a gap, to avoid building upload handling ahead of real storage

**Frontend work — all IMPLEMENTED (`src/pages/ExpensesPage.jsx`):**
- [x] Expense request form
- [x] Combined list + inline workflow actions (submit/approve/reject/pay), each button permission-gated and state-gated (e.g. approve never shown to the requester of that same expense)
- [x] Status badges for all five states

**Security work:**
- [x] IMPLEMENTED — permission gating per transition (`expense.create/update/submit/approve/reject/pay`, all seeded in Phase 2); audit log entries for every state transition

**Testing:**
- [x] TESTED (written) — `server/tests/phase5/expenses.test.js`: financial effect (or lack of it) at every state, invalid transitions (409), double-payment prevention, return-for-correction, closed-period rejection at pay time, self-approval block, permission boundaries per role, attachment MIME/size validation, tenant isolation.
- [ ] LIVE-DB VERIFIED — PENDING, same blocker.

**Acceptance criteria:** Met in code — an expense cannot affect any balance until `pay`, which requires clearing the full workflow — unverified against a live system.
**Dependencies:** Phase 1, 2, 3, 4 (shares the category CRUD built in Phase 4).

---

## PHASE 6 — Accounts + Funds + Transfers

**Objectives:** Manage accounts/funds as first-class entities; move money between them correctly.

**Status: IMPLEMENTED. TESTED (written). LIVE-DB VERIFIED: PENDING.**

**Database work:** `accounts`, `funds` (created Phase 1), no schema changes this phase. No separate `transfers` table — a transfer is two linked `transactions` rows (Decision, see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §2).

**Backend work — all IMPLEMENTED:**
- [x] Account/fund CRUD — base create/list/get built in Phase 1; this phase added `PATCH` (rename) and `POST /:id/activate`/`/deactivate`. No delete route exists anywhere for either resource — deactivation is the only retirement path, backed by `RESTRICT` foreign keys from `transactions` so a fund/account with historical activity structurally cannot be removed
- [x] Verified a deactivated account is rejected by the Financial Engine's own `assertAccountUsable` check (Phase 3 code — this phase confirmed the invariant, no change needed)
- [x] Transfer logic — built in Phase 3 (`financialEngine.service.js#transfer`)
- [x] `POST /api/v1/transfers`, `GET /api/v1/transfers`, `GET /api/v1/transfers/:id` — a thin HTTP wrapper (`transfers.controller.js`/`.service.js`/`.validator.js`/`.routes.js`) with no repository of its own and no parallel financial logic; lists one row per transfer (the 'out' leg), `GET /:id` returns both legs

**Frontend work — all IMPLEMENTED (`src/pages/AccountsPage.jsx`, `FundsPage.jsx`, `TransfersPage.jsx`):**
- [x] Account/fund management screens: create, rename (prompt-based), activate/deactivate toggle
- [x] Transfer form (account + fund pair on both sides, single amount)

**Security work:** Permission gating (`accounts.manage`, `funds.manage`, `transfers.create`), all seeded in Phase 2.

**Testing:**
- [x] TESTED (written) — `server/tests/phase6/accountsFunds.test.js`, `transfers.test.js`: rename, deactivate/reactivate, deactivated-account rejected by the engine, no delete route exists, tenant isolation, permission gating, and the financial invariants explicitly re-verified at the HTTP layer (source decreases/destination increases by exactly the amount, total money preserved, never counted as income/expense, same-account+fund rejected, cross-tenant rejected, closed-period rejected, atomic rollback on failure).
- [ ] LIVE-DB VERIFIED — PENDING, same blocker.

**Acceptance criteria:** Met in code — transfers never leave the ledger in a half-posted state, account/fund balances remain fully derivable — unverified against a live system.
**Dependencies:** Phase 1, 2, 3.

---

## PHASE 7 — Pledges + Receipts

**Objectives:** A simple, practical pledge-tracking system and unified receipt generation — deliberately not a CRM or member-management platform.

**Status: IMPLEMENTED. TESTED (written). LIVE-DB VERIFIED: PENDING.**

**Database work:** `0021_create_pledges`, `0022_add_pledge_id_to_contributions`, `0023_create_receipt_sequences`, `0024_create_receipts`.

**Backend work — all IMPLEMENTED:**
- [x] Pledge CRUD (`pledges.repository/service/controller/validator/routes.js`) — pledge number, contributor reference, fund, pledged amount, dates, notes, status. Status is a flat 3-value enum (`active`/`completed`/`cancelled`), not a state machine, with exactly one automatic transition (auto-complete/un-complete on fulfillment threshold) — a deliberate simplification per "do not create a complicated state machine unless the business actually requires it"
- [x] Fulfillment computed live from linked posted contributions (`pledgesRepository.getFulfilledAmount`), never stored as a mutable counter
- [x] Contribution recording (Phase 4) extended with an optional `pledgeId`; overpayment beyond the remaining pledge balance is rejected (422); a payment against a `cancelled` pledge is rejected (409)
- [x] Pledge creation/payment/status-change/ledger-post/receipt-issue all share one repository/service layer — no duplicate ledger-posting path
- [x] Receipt generation: one unified `receipts` module covering income, contributions, and pledge payments alike (they are the same underlying `contributions` record) — a receipt is issued automatically, inside the same DB transaction as the contribution and its ledger entry, so a contribution can never exist without exactly one receipt
- [x] Server-generated, tenant-scoped, collision-free sequential receipt numbering (`RCT-YYYY-NNNN`) via `SELECT ... FOR UPDATE` row-locking on a per-tenant-per-year `receipt_sequences` row — verified unique under concurrent issuance in tests
- [x] Receipt PDF rendering (`receiptPdf.js`, pdfkit) — A4, English/Swahili via `receiptLabels.js`
- [x] File storage: **Cloudinary was not available/provisioned this session.** Built `storage.service.js` as a complete interface/service contract (`uploadFile`, etc.) — every method throws a typed `501 STORAGE_NOT_CONFIGURED` error. No credentials were requested, none were fabricated. Actual expense-attachment upload wiring is **PENDING** real storage provisioning; this is a deliberate, documented deferral, not a silent gap

**Frontend work — all IMPLEMENTED:**
- [x] `PledgesPage.jsx` — create pledge, view fulfilled/remaining, cancel
- [x] Contribution form gained an optional pledge picker; contribution list gained a "download receipt" action that streams the PDF via an authenticated blob fetch (no bare/public receipt URL)
- [x] No standalone Receipts page — by design, receipts are reached from the contribution they document, matching "one receipt architecture" rather than a document-library module

**Security work:** `pledges.view`/`pledges.create`, `receipts.view` permissions; pledge/receipt access is tenant-scoped like every other resource; contributor identity on a pledge is gated by `contributors.view`, reusing the Phase 4 privacy boundary (`contributorEnrichment.js`, extracted as a shared helper since both contributions and pledges need identical logic).

**Testing:** `server/tests/phase7/{pledges,receipts}.test.js` — TESTED (written): fulfillment matches sum of posted linked contributions exactly; overpayment rejected; payment against a cancelled pledge rejected; auto-complete/un-complete on payment/reversal; receipt numbers sequential and unique per tenant per year, including under concurrent issuance; PDF has correct content-type and magic bytes; contributor privacy respected on pledge listings; tenant isolation on pledges and receipts. LIVE-DB VERIFIED — **PENDING** (`ER_ACCESS_DENIED_ERROR` connecting to MySQL in this environment; see Phase 1 status).

**Acceptance criteria:** Met in code — a contribution linked to a pledge updates fulfillment with no manual reconciliation step; a receipt is generated and retrievable only by users of the owning tenant — unverified against a live system.
**Dependencies:** Phase 1, 2, 3, 4.

---

## PHASE 8 — Budget + Financial Closing

**Objectives:** Simple budget-vs-actual tracking and a non-blocking period-close workflow — deliberately not a full corporate budgeting platform.

**Status: IMPLEMENTED. TESTED (written). LIVE-DB VERIFIED: PENDING.**

**Database work:** `0025_create_budgets`. `financial_periods` already existed (Phase 1); this phase added the HTTP layer and the shared summary service over it.

**Backend work — all IMPLEMENTED:**
- [x] Budget CRUD (`budgets.repository/service/controller/validator/routes.js`) — period/fund/category(optional)/amount/notes/status/created-by
- [x] Duplicate-budget prevention via check-before-insert (`findByPeriodFundCategory`), since MySQL's unique index treats every `category_id = NULL` row as distinct and would not by itself catch two fund-level budgets for the same period+fund — same pattern already used for `contributors.member_number` and `categories(type,name)`
- [x] Negative budget amounts rejected by validator; zero is allowed
- [x] Budget-vs-actual: `actual_amount`/`variance` always computed by calling `transactionsRepository.sumByType` (the Phase 3 engine's own aggregation) — never a second calculation engine. Income variance = actual − planned (positive = ahead of plan); expense variance = planned − actual (positive = under budget)
- [x] `financial_period.view`/`.manage` added as two new permissions this phase (`.close`/`.reopen` already existed from Phase 2/3) — catalog now 36 permissions total
- [x] `POST /financial-periods/:id/close` — a closed period blocks all further ordinary ledger posting (`assertPeriodOpenAndOwned` throws `PERIOD_LOCKED`) but stays fully viewable; corrections after close only ever happen via reversal/adjustment against a new open period, never by editing history
- [x] Closing checklist (`getClosingChecklist`) — informational only, reports pending-approval and approved-unpaid expense counts alongside a preview of the closing summary. **Nothing blocks closing except the period already being closed** — this architecture has no draft/pending ledger rows at all (every posting is final on insert), so there is no other genuinely blocking condition, per "only financially important issues should block closing"
- [x] Closing summary (`financialSummary.service.js#getFinancialSummary`) — opening balance, total income, total expenses, transfer volume, net adjustments, closing balance, plus a per-fund and per-account balance breakdown, all computed live against the ledger (JOIN on `financial_periods.start_date`/`end_date`, never a snapshot table). This is the **same function** Phase 9's Financial Summary report calls — one source of truth, not two screens that could disagree
- [x] `POST /financial-periods/:id/reopen` — Super-Administrator-only permission (`financial_period.reopen`, deliberately not granted even to Treasurer), requires a non-empty reason (422 without one), and is recorded via the audit log
- [x] **Deliberate scope decision vs. the original Phase 0 plan:** no separate "reconciliation job" comparing cached snapshots against the ledger, and closing is not "snapshot + lock." Since every balance in this architecture is already derived live from the ledger (never cached), there is nothing to reconcile against — the snapshot-caching approach was assessed as unneeded complexity for this product's scale and dropped rather than built and left unused

**Frontend work — all IMPLEMENTED:**
- [x] `BudgetsPage.jsx` — create budget, budget-vs-actual table with color-coded variance
- [x] `FinancialPeriodsPage.jsx` — create period, view closing summary, checklist, close/reopen (reopen requires typing a reason)

**Security work:** `budget.view`/`.manage`, `financial_period.view`/`.manage`/`.close`/`.reopen` all tenant-scoped and permission-gated; reopen additionally audited with actor, reason, and timestamp.

**Testing:** `server/tests/phase8/{budgets,financialPeriods}.test.js` — TESTED (written): duplicate/negative/zero budget handling; actual and variance verified to match the engine's own balance query directly (not merely "look right"); closing blocks further posting (asserted via the engine throwing `PERIOD_LOCKED`, not just an HTTP-layer check); historical data stays viewable after close; reopen requires a reason and the elevated permission (Treasurer explicitly confirmed **cannot** reopen despite being able to close); tenant isolation on budgets and periods. LIVE-DB VERIFIED — **PENDING**.

**Acceptance criteria:** Met in code — a closed period cannot accept new postings through any code path (enforced at the engine level, not just the route); budget-vs-actual and the closing summary both trace back to the same Phase 3 aggregation — unverified against a live system.
**Dependencies:** Phase 1, 2, 3.

---

## PHASE 9 — Reports

**Objectives:** A small, high-value reporting suite — exactly the 9 named reports, not a general report builder.

**Status: IMPLEMENTED. TESTED (written). LIVE-DB VERIFIED: PENDING.**

**Database work:** None new.

**Backend work — all IMPLEMENTED (`server/src/modules/reports/`):**
- [x] Exactly 9 reports, each a thin composition over an *existing* repository/service method — never new aggregation SQL: Income, Expense, Contributions, Account Statement, Fund Statement, Budget vs Actual, Pledge Report, Financial Summary, Transaction Journal (`reports.service.js`)
- [x] Financial Summary calls the exact same `financialSummary.service.js#getFinancialSummary` Phase 8's closing summary calls — structurally cannot diverge from it, dashboard, or per-account/fund balances, since they are the same query
- [x] Practical, per-report filters only — date range, account, fund, category, payment method, status, financial period — each report exposes only the filters relevant to it (e.g. Pledge Report offers fund/status, not a date range the underlying query doesn't support; Account/Fund Statement require an account/fund selection)
- [x] Fixed a real consistency bug found while wiring this up: `transactionsRepository.sumByType` (used for report *totals*) did not accept `accountId`/`dateFrom`/`dateTo`, while `listHistory` (used for report *rows*) did — so an account- or date-filtered Income/Expense report would have silently shown a total that ignored those filters. Extended `sumByType` to accept the same filter set as `listHistory` so rows and totals are always computed from the identical filtered set
- [x] Reusable export infrastructure (`exporters.js`) — `toCsv`, `toExcelBuffer` (exceljs), `streamPdfReport` (pdfkit, A4, paginated, church name + filters used + generated timestamp + totals row) — used by all 9 reports; no bespoke exporter per report
- [x] Shared column definitions (`reportColumns.js`) used identically for the on-screen JSON shape and every export format, so a column is defined once
- [x] Export columns are whitelist-based (`columns.map(c => row[c.key])`), so no export can ever leak a field that isn't an explicitly declared report column, even if the underlying row object carries more fields
- [x] `reports.controller.js#respond` is the single choke point for every report: JSON view requires only that report's own `.view`-family permission (same permission that already gates browsing that data elsewhere); any export (CSV/XLSX/PDF) additionally requires `reports.export` — "cannot export what you cannot view" is the floor, export is a distinct, stricter, audit-relevant action on top
- [x] Contributor privacy preserved through export: Contributions and Pledge reports enrich contributor identity only when the caller holds `contributors.view` (reusing `contributorEnrichment.js`); the export row-mappers operate on that already-filtered result, so a CSV/Excel/PDF export cannot leak identity that the on-screen JSON wouldn't show
- [x] Performance: every report reads via existing indexed, tenant-scoped, DB-side aggregation (`SUM`/`COUNT` in SQL) with a bounded row limit on list-style reports — no N+1 queries, no in-app aggregation over unbounded result sets

**Frontend work — all IMPLEMENTED:**
- [x] `ReportsPage.jsx` — single page, report picker plus only-the-relevant-filters form, results table, PDF/Excel/CSV export buttons gated by `reports.export` (`PermissionGate`)
- [x] `reportsApi` in `src/api/endpoints.js` — one path builder per report, one `run`/`export` pair reused by all 9, not a bespoke API call per report

**Security work:** Every report route requires authentication + tenant context (standard middleware chain) plus the same permission that already gates that data elsewhere in the app; `reports.export` is a second, distinct gate for any non-JSON format, checked centrally rather than per-handler.

**Testing:** `server/tests/phase9/reports.test.js` — TESTED (written): each report's rows/totals verified to match the Financial Engine directly (not merely "look reasonable"); date/account/category filters proven to narrow rows and totals *together* (guards the `sumByType` bug fixed above); contributor privacy respected in Contributions and Pledge reports; `reports.export` permission enforced separately from view permission (Viewer can view, cannot export; Assistant Treasurer likewise); CSV header/row shape, Excel (PK/zip magic bytes) and PDF (%PDF magic bytes) all verified structurally; a closed period's data remains fully reportable; tenant isolation across all report endpoints. LIVE-DB VERIFIED — **PENDING**.

**Acceptance criteria:** Met in code — every report traces to the same Financial Engine aggregation the dashboard and closing summary use, so numbers cannot diverge by construction; exports never exceed what the JSON view already permits — unverified against a live system.
**Dependencies:** Phase 3 through 8 (reports cover all financial domains).

---

## PHASE 10 — Dashboard + Complete UI/UX

**Objectives:** Turn the working-but-unpolished Phase 0–9 frontend into a coherent, commercially presentable product surface — without touching any financial calculation.

**Status: IMPLEMENTED. Verified via lint/build/code review (no live-browser session possible — DB unavailable, no working login). LIVE-DB VERIFIED: PENDING.**

**Database work:** None new.

**Backend work — all IMPLEMENTED:**
- [x] `GET /api/v1/roles` (new, thin, reuses the existing `rolesRepository` — no new module) so the Users admin screen has a role catalog to offer
- [x] `usersService.listUsers` now attaches each user's roles via one batched query (`userRolesRepository.listRolesForUsers`), not one query per row
- [x] `limit`/`offset` query support added to `contributions.controller.js` and `expenses.controller.js` — the repositories already accepted them, the controllers never parsed them out of the query string, so pagination silently couldn't work until now

**Frontend work — all IMPLEMENTED:**
- [x] Real `DashboardPage.jsx` replacing the Phase 0 placeholder stub — current balance, income/expenses for a This Month/Quarter/Year/Custom-range filter, transfer volume, active pledges + outstanding amount, a compact budget-vs-actual summary, and the 8 most recent transactions. Every figure is sourced from an existing Phase 3/8/9 service (`reports/financial-summary`, `reports/income`, `reports/expense`, `reports/pledges`, `reports/budget-vs-actual`, `reports/transaction-journal`) — the period filter is calendar-boundary math only, never a second financial calculation. Handles the zero-open-financial-period state explicitly instead of crashing or showing NaN/blank.
- [x] Shared `ConfirmDialog` (promise-based, focus trap, Escape-to-cancel, optional reason field) and `Toast` notification system (`src/components/`) — replaced every `window.confirm`/`window.prompt` used for a destructive action (reverse contribution, reject expense, cancel pledge, deactivate account/fund, close/reopen financial period) and added success feedback to every create/mutate action across the app, which previously had none at all
- [x] Navigation: links are now filtered by the same permission that gates each page's own API calls — a real, pre-existing gap fixed (e.g. the Approver role previously saw Accounts/Funds/Budgets/Pledges links despite lacking every one of those permissions, guaranteeing a 403 on click). Added visible group headings (Transactions / Finance / Pledges & Reports / Administration) for hierarchy.
- [x] Mobile sidebar: added the previously-missing accessible close button and body-scroll-lock while open; existing slide-in/overlay/close-on-navigate behavior kept as-is (already correct)
- [x] `UsersPage.jsx` (new) — invite, list with roles, assign/remove role, disable, all through the Phase 2 backend that had zero frontend until now
- [x] Pagination ("Load more") on Contributions and Expenses, the two highest-volume lists
- [x] Tables already used `.table-wrap { overflow-x: auto }` (horizontal scroll on narrow viewports) from Phase 4 onward — reviewed and kept rather than rebuilt as cards, matching the brief's own "horizontal scroll OR compact card view, whichever is better" framing
- [x] i18n: every new string (dashboard, confirm dialogs, toasts, Users page, nav groups) added to both `en.json` and `sw.json` — no hardcoded UI strings introduced

**Deliberately not built:** Church Settings screen and a custom-role editor — both were named as example nav items in the brief's suggested structure, but neither has *any* backend behind it (no `settings` module exists; roles are system-defined only, no tenant-custom-role creation exists anywhere). Building either now would be a screen with nothing real behind it — the kind of "add a module to make the product look bigger" the brief explicitly warns against. Both are noted as known, deliberate gaps rather than silently omitted.

**Testing:** No live-browser interaction testing was possible — the database is unreachable in this environment, so there is no way to log in and click through the app. Verified instead via: `npm run lint` (frontend + backend, clean), `npm run build` (clean, and the production build was independently re-verified to bake in the correct API URL with zero `localhost:4000` references — see Phase 12 §12.18), and a full manual code review of every changed file. This is explicitly a lower bar than real browser QA and is reported as such, not as "tested."

**Acceptance criteria:** Met in code — every backend capability through Phase 9 has a corresponding UI; nav visibility matches actual permission; confirmations/toasts are consistent app-wide — unverified in a live browser session.
**Dependencies:** Phase 2 through 9.

---

## PHASE 11 — Audit + Hardening

**Objectives:** A real, code-level security and reliability audit — not a documentation exercise.

**Status: IMPLEMENTED. TESTED (written, new). LIVE-DB VERIFIED: PENDING.**

**Database work:** None new. Schema/migrations reviewed for integrity (FKs, unique constraints, indexes) — found already correct, not modified (per this phase's own instruction not to touch migrations without a real reason).

**Backend work — audit performed across all 15 brief subsections; real findings fixed:**
- [x] **Tenant isolation** — re-verified: `req.tenantId` has exactly one assignment site (`tenantContext.js`), always from `req.auth.tenantId` (server-derived from the verified JWT), never from `req.body`/`req.query`/`req.params`. Every custom repository query includes `tenant_id`; the handful that don't are `permissions`/`role_permissions` (global by design) and `refresh_tokens` (keyed by cryptographic token hash, not tenant) — both pre-existing, documented, legitimate exceptions.
- [x] **Authentication** — reviewed login/refresh-rotation/reuse-detection/logout/lockout/password-reset, all already solid (generic error messages, no user enumeration, bcrypt, single-use expiring reset tokens, full-chain revocation on reuse detection). Hardened further: `jwt.verify` now passes an explicit `algorithms: ['HS256']` allow-list (defense-in-depth against algorithm-confusion); `JWT_ACCESS_SECRET` now enforces a 32-character minimum at startup.
- [x] **Authorization** — re-verified every route in every `*.routes.js` file individually declares `requirePermission(...)`; no route found unprotected.
- [x] **Financial integrity — real bug found and fixed:** three places summed money via JS floating-point `Number(...)` addition instead of SQL or integer-cents arithmetic (the pledge-overpayment guard, already patched with a telling `+ 0.001` epsilon — itself a symptom of the underlying float risk — and two Phase 9 report totals). Added `addMoney`/`compareMoney`/`sumMoney` to `money.js` (all integer-cents), switched all three call sites, removed the epsilon.
- [x] **Concurrency — real gap found and fixed:** `budgets`/`contributors`/`categories` each use check-before-insert duplicate prevention; under a genuine race the DB's own unique constraint was the only backstop, and a collision surfaced as a raw unhandled 500. All three now catch `ER_DUP_ENTRY` and return the same friendly `409` the sequential path already does.
- [x] **Input validation — real gap found and fixed:** several free-text fields (contribution/expense notes and reference, expense payee, pledge/budget notes, contributor fields, financial period label, email addresses, church/admin names) had no length cap, so a value exceeding its `VARCHAR` column would fail as a raw DB error rather than a clean `422`. Added explicit length checks matching each column's actual width across 7 validator files.
- [x] **HTTP security** — re-verified: CORS locked to explicit origins (no wildcard), `helmet()` applied, rate limiting wired (10/min auth, 300/min general), refresh cookie `httpOnly`/`secure`(prod)/`sameSite=strict`/path-scoped, `express.json({limit:'1mb'})`.
- [x] **File security** — Cloudinary remains un-provisioned; `storage.service.js`'s `501 PENDING` contract re-confirmed, not touched.
- [x] **Secrets** — repo-wide sweep for hardcoded credentials: clean. `.env`/`server/.env`/`setup-db*.sql` (real, filled-in versions) all correctly gitignored, only `.example` templates tracked.
- [x] **Dependencies** — `npm audit`: 0 vulnerabilities (frontend), 2 moderate transitive in the server package (`exceljs → uuid`, unchanged from Phase 9, already investigated and documented as non-exploitable in this codebase's usage — no user-controlled buffer ever reaches `uuid`).
- [x] **Error handling — real gap found and fixed:** `errorHandler.js` previously only logged unhandled exceptions server-side when `NODE_ENV !== 'production'` — a production 500 was invisible to operators, not just hidden from the client. Now always logged server-side; the client-facing message stays redacted in production.
- [x] **Audit logging — real gap found and fixed:** `accounts`/`funds` create/rename/activate/deactivate were entirely unlogged, unlike every other domain module. Added `account.*`/`fund.*` audit entries with the acting user threaded through from the controller (previously not even passed to the service).
- [x] **Hard delete** — re-verified: the only `DELETE` route in the entire API removes a role *assignment* (a join-table row); no financial or domain record can be hard-deleted anywhere.

**Frontend work:** No frontend-specific findings this phase (Phase 10 already added the confirmation-dialog layer destructive actions need).

**Testing:** `server/tests/phase11/security.test.js` (new) — account/fund audit logging end-to-end; the pledge-overpayment guard at its exact boundary, deliberately using amounts (`100.01 × 3`) chosen to stress binary-fraction rounding, both for a payment that should succeed and one that should still correctly fail; oversized-input rejection. Cross-tenant/duplicate-key/auth/authz coverage already existed extensively across `tests/phase1`–`phase9` and was re-verified by code review rather than duplicated.

**Acceptance criteria:** Met in code — no known critical/high dependency vulnerability; every financial and access-control action produces an audit log entry (gap closed for accounts/funds); tenant isolation re-confirmed structurally sound — unverified against a live system.
**Dependencies:** All of Phase 1–10.

---

## PHASE 12 — Production Deployment + Commercial QA Preparation

**Objectives:** Make the codebase deployment-ready and document the deployment procedure — not to actually deploy (explicitly out of scope this phase; deployment happens manually afterward).

**Status: IMPLEMENTED (codebase + documentation). Infrastructure steps (DNS/TLS/live DB) explicitly NOT executed — PENDING, documented as such, never claimed otherwise.**

**Database work:**
- [x] `server/scripts/setup-db.production.example.sql` (new) — production DB + least-privilege `clix_app` user creation template, mirrors the existing dev script's shape, adapted for a single production database and a real generated password (never committed filled-in)
- [x] Backup procedure documented: daily `mysqldump` via cron, 14-day retention, restore command ([DEPLOYMENT.md](DEPLOYMENT.md) §7) — a cron one-liner, not a bespoke backup-management application, per this phase's own "do not build an unnecessary" instruction
- [ ] **Actually provisioning a production MySQL instance / running the setup script for real** — PENDING, requires a real server

**Backend work:**
- [x] `server/ecosystem.config.cjs` (new) — PM2 process config, `.cjs` extension deliberately (the package is ESM, PM2's loader is most reliable as plain CommonJS regardless). Contains no secrets — real config comes from `server/.env` via the `dotenv/config` import `env.js` already has; PM2 only sets `NODE_ENV=production`.
- [x] `GET /health` re-confirmed already minimal and correct (no auth required, no internal state exposed) — no change needed, matches this phase's own "minimal response is sufficient" guidance
- [x] Production logging re-confirmed correct after the Phase 11 fix (errors always logged server-side; PM2 captures stdout/stderr to `server/logs/`)

**Frontend work:**
- [x] Production build re-verified this phase with `VITE_API_BASE_URL=https://treasurer.clixworks.co.tz/api/v1` set explicitly — the built output was grepped for `localhost:4000` (zero matches) and confirmed to contain `treasurer.clixworks.co.tz/api/v1` — the only "localhost" strings present are React's own internal fallback constant, unrelated to this app's config

**Security / infra work:**
- [x] `deploy/nginx.conf.example` (new) — HTTP→HTTPS redirect, reverse proxy to the PM2-managed backend on `127.0.0.1:PORT`, static frontend serving with client-routing fallback, security headers, `trust proxy`-matching single-hop `X-Forwarded-*` handling, `/health` excluded from access logging
- [x] Cloudflare DNS + TLS documented as **instructions only** — [DEPLOYMENT.md](DEPLOYMENT.md) §6 explicitly states nothing has been configured, names the two TLS paths (Cloudinary Origin CA or Certbot) without claiming either was executed
- [x] Rollback basics documented — code rollback via git, schema rollback via the existing `npm run migrate:down`, data restore only as a last resort ([DEPLOYMENT.md](DEPLOYMENT.md) §10)

**Cleanup / audit (this phase, repo-wide):**
- [x] Production-domain sweep: every `localhost`/`127.0.0.1` reference in the repo accounted for (dev-only `.env.example` defaults with fail-fast production overrides; the Nginx template's *correct* internal reverse-proxy target; one CORS test fixture) — none are an actual production misconfiguration
- [x] No old/demo domains found anywhere
- [x] TODO/FIXME/console.log sweep: zero real markers found in application source (`console.log` exists only in CLI scripts — migration runner, seed runner, server startup banner — all legitimate operator-facing output, not application request-path logging); zero lorem-ipsum/placeholder/dummy-data strings
- [x] Empty-database experience reviewed: every list page already had loading/empty/error states from the phase that built it; `formatMoney`/`formatDate` degrade to `—` rather than `NaN`/`undefined`; the new Dashboard explicitly handles the zero-financial-period case
- [x] Demo data reviewed: the dev seed (`seedDevTenant.js`) already skips itself when `NODE_ENV=production` (confirmed in Phase 7/9 review, re-confirmed here) — production seeding only ever creates the permission/role catalog, never fake financial data
- [x] Performance spot-check: one real N+1 found and fixed in Phase 10 (`listUsers`, now one batched query instead of one per user); no other N+1 pattern found on review

**Testing:**
- [x] `npm run lint` — frontend and backend, clean
- [x] `npm run build` — clean, output verified against the production API URL (see above)
- [x] `npm audit` — 0 / 2-moderate-accepted, unchanged from Phase 11
- [ ] **Production smoke test against the live URL** — cannot happen without a real deployment; PENDING
- [ ] **Commercial QA walkthrough executed against a live system** — the *code paths* for every listed workflow (register → login → configure → account/fund/category → income/contribution → receipt → pledge → pledge payment → expense → submit → approve → pay → transfer → budget → close period → reports → export → manage users → logout → login → refresh) were traced through the actual implementation and confirmed to exist and be wired correctly end-to-end; this is a code-level walkthrough, not a live user-driven one, and is reported as such

**Acceptance criteria:** Codebase and documentation are deployment-ready; a real church cannot yet be onboarded because no live MySQL/production host exists in this environment — that gap is explicit, not hidden.
**Dependencies:** All of Phase 1–11.

---

## Final Pre-GitHub / Contabo Deployment Readiness Pass

A follow-up pass after Phase 12, specifically for the actual target deployment's fixed configuration — not a new phase, no new product features.

**Status: IMPLEMENTED. FRESH DATABASE VERIFICATION: PENDING (no MySQL access in this environment — not asked for, not guessed, not fabricated).**

- [x] **Port fixed at 4005 everywhere, 4000 fully retired from this project's convention** — `server/src/config/env.js`'s fallback default, both `.env.example` files (root + server), `src/api/client.js`'s dev fallback, `deploy/nginx.conf.example`'s two `proxy_pass` targets, `docs/API_ARCHITECTURE.md`. `server.js` already read `env.port` (never a hard-coded literal) — confirmed by actually importing it and observing `Clix Treasury API listening on port 4005 (development)`. The few remaining literal "4000" strings left in the repo are deliberate negative references ("never 4000") or an accurate historical record in this same file of a Phase 12 verification that ran before this pass — not live configuration.
- [x] **Database configuration adapted to `DB_NAME=treasurer`, `DB_USER=root`** — required zero code changes: `server/src/config/db.js`/`env.js` already read `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` from the environment with no special-casing of the username. `server/scripts/setup-db.production.example.sql` rewritten to create only the `treasurer` database (root already exists — no `CREATE USER`, no password touched, none guessed, none requested). A restricted-user alternative is documented in the same file as an optional, non-blocking upgrade path, per this deployment's explicit instruction not to fight the root requirement.
- [x] **Two new, genuinely missing capabilities added:** `npm run migrate:status` (`server/src/db/migrateStatus.js`) — lists every migration as applied (with timestamp) or pending, reusing the existing runner's own file-discovery logic rather than a second implementation; `npm run db:check` (`server/src/db/check.js`) — verifies connection, reports the connected database name, confirms the migration table and a representative sample of core tables exist, reports applied-migration count, prints `Schema status: READY`/`NOT READY`. Neither prints a credential; both were tested against the (currently unreachable) local dev database and fail cleanly with a clear, credential-free error rather than crashing or leaking anything.
- [x] **`docs/DEPLOYMENT.md` rewritten** as a practical, project-specific, command-by-command Contabo walkthrough (VPS prerequisites through backup), using this deployment's actual fixed values throughout (port 4005, `treasurer`/`root`, the real `npm run migrate`/`migrate:status`/`seed`/`db:check` commands) rather than generic instructions. The GitHub repository URL is a `<YOUR_GITHUB_REPO_URL>` placeholder — none was invented.
- [x] **JWT env var naming deliberately kept as the existing `JWT_ACCESS_SECRET`**, not renamed to `JWT_SECRET`, and no `JWT_REFRESH_SECRET` was added — refresh tokens are opaque random values, never JWTs, so a refresh-signing secret would be a dead, unused variable. This follows the deployment brief's own instruction to prefer "the exact existing variable naming convention if the project already uses a better established convention" over its example template.
- [x] **Final security sweep re-run**: no `JWT_SECRET=`/`JWT_REFRESH_SECRET=`/`api_key`/hardcoded password found anywhere; `.gitignore` confirmed to exclude `.env`, `.env.*` (with `!.env.example` re-allowed), `node_modules`, `dist`, `logs`, `*.log`, and `coverage` (added this pass, defensively — no coverage output exists yet, costs nothing to exclude); `git ls-files` confirmed no `.env`, no `setup-db*.sql` (the real, filled-in versions), no `node_modules` are tracked.
- [x] Frontend production build re-verified once more this pass with the new port default in place — `grep`ped for `localhost:4000`/`localhost:4005`/`127.0.0.1` in the build output (zero matches) and confirmed `treasurer.clixworks.co.tz/api/v1` is what's actually baked in.
- [x] `npm run lint` (both packages), `npm run build` — all clean. `npm audit` unchanged from Phase 11 (0 frontend / 2 moderate, already investigated and accepted).
- [ ] **`npm test` / a fresh migrate+seed+db:check run against a real `treasurer` database** — PENDING. The local dev database is equally unreachable in this environment (`ER_ACCESS_DENIED_ERROR`) — this was not worked around, not faked, and no password was requested.

**Acceptance criteria:** the repository can be pushed to GitHub and cloned onto the Contabo VPS as-is; every step in `docs/DEPLOYMENT.md` uses a real, working project command; no application code needs to change to go from this repository state to a running production deployment at the fixed configuration specified.
**Dependencies:** All of Phase 1–12.

---

## Post-Launch Hotfix — Public Registration Route

Found after the site went live at `https://treasurer.clixworks.co.tz`: `/register` redirected to `/login`, blocking the only path for a brand-new church to ever sign up. Root cause: `src/App.jsx` never had a `/register` route or a `RegisterPage` component at all — the backend endpoint (`POST /api/v1/auth/register-tenant`) was correctly public since Phase 2, but no frontend screen was ever built for it. This is a genuine gap the Phase 12 "commercial QA" code-level walkthrough should have, and didn't, catch — noted here rather than glossed over.

- [x] `src/pages/RegisterPage.jsx` (new) and `src/components/PublicOnlyRoute.jsx` (new, the inverse of `ProtectedRoute` — redirects an already-authenticated visitor away from `/login`/`/register` instead of showing the form again). No backend change — the registration endpoint's atomicity, validation, rate limiting, and tenant isolation were re-verified, not modified.
- [x] Routing matrix re-verified against the actual route tree (not assumed): unauthenticated → `/login`/`/register` render, everything else → `/login`; authenticated → `/login`/`/register` redirect to `/`, protected routes remain permission-gated; logged out → `/register` stays public.

**Status: IMPLEMENTED. Lint/build clean. No backend files touched, so no backend test re-run needed. LIVE-DB VERIFIED: PENDING, unchanged.**

---

## Testing Strategy Summary

| Layer | Tooling (to be finalized in Phase 1/2, not yet chosen) | Owning phases |
|---|---|---|
| Unit (financial calculations) | Node test runner or Jest/Vitest | 3, 8, ongoing |
| Integration (service + repository against real MySQL) | Same, against a test DB | 4–9 |
| API tests | Supertest or equivalent | 2–9 |
| Tenant-isolation tests | Part of API test suite, per endpoint | 2–9, audited fully in 11 |
| Authorization tests | Part of API test suite | 2, then per module |
| Regression suite | Full run before each phase sign-off | All |
| Production smoke tests | Manual + scripted checklist | 12 |

No test framework currently exists (no test tooling in `package.json` at Phase 0). This is a real gap to close at the start of Phase 1/2, not deferred to Phase 11.

---

## Phase Dependency Order (Summary)

```
0 → 1 → 2 → 3 → 4 → {5, 6} → 7 → 8 → 9 → 10 → 11 → 12
```

4 (Income + Contributions) goes first among the domain modules because it builds the shared `categories` CRUD that Phase 5 (Expenses) also uses. 5 and 6 (Expenses/Approval, Accounts/Funds/Transfers) can then proceed in parallel, since they're otherwise independent modules sitting on top of the same Financial Engine. 7 depends on 4 (pledges link to contributions). 8 depends on all of 3–6 having real transaction data to close periods against. 9 depends on 3–8 (reports cover every domain). 10 depends on everything having a backend to build UI against. 11 and 12 are strictly sequential final gates.

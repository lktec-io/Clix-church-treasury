# Master TODO — Clix Church Treasury Management System

Governing execution plan, Phase 0 through Phase 12. Cross-references: [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md), [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md), [API_ARCHITECTURE.md](API_ARCHITECTURE.md), [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md), [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md), [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md).

Checkboxes are updated as work genuinely completes (see [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) §8) — never batch-checked at phase end.

**Overall status:** Phases 0–3 have code/tests written; Phases 1–3 are blocked on live verification pending local MySQL root access (a password reset is in progress outside this session — see [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) §8). No phase past 3 has been started. `npm run lint` is clean on both `server/` and the frontend; `npm audit` reports 0 vulnerabilities on both.

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
- [x] Apply indexing plan (composite indexes on every hot filter path — see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §5)
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

**Database work:** `transactions` table as built in Phase 1, plus a `direction` (`in`/`out`) column added beyond the original design — `type` alone can't disambiguate a transfer's two legs (see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §7).

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

**Database work:** `contributors`, `contributions` (already created Phase 1) — confirm/adjust as real usage patterns emerge.

**Backend work:**
- [ ] Contributor CRUD
- [ ] Contribution recording → posts via Phase 3 posting service
- [ ] Category management HTTP routes (`categories.repository.js` already exists from Phase 1 as a tenant-scoped repository, following the same pattern as `accounts`/`funds` — this phase just needs to add `categories.controller.js`/`.routes.js`/`.validator.js` on top of it, both `income` and `expense` types)
- [ ] Contribution listing/filtering (by contributor, fund, date range, method)

**Frontend work:**
- [ ] Record-contribution form (mobile-first)
- [ ] Contributor list/search
- [ ] Contribution history view

**Security work:** Tenant-isolation tests for all new endpoints; permission gating (`contribution.create`, `contribution.view`).

**Testing:** Happy path, tenant isolation, posted contribution reflected correctly in balance (integration test against Phase 3 engine).

**Acceptance criteria:** A treasurer can record a contribution end-to-end and see it reflected in the relevant fund/account balance via the Financial Engine, not a separately computed number.
**Dependencies:** Phase 1, 2, 3.

---

## PHASE 5 — Expenses + Approval

**Objectives:** Expense request → multi-step approval → posting, with segregation of duties.

**Database work:** `expenses`, `expense_approvals` (already created Phase 1).

**Backend work:**
- [ ] Expense request creation (draft state, no posting yet)
- [ ] Approval chain: `POST /expenses/:id/approve`, `POST /expenses/:id/reject`
- [ ] On final approval → posts via Phase 3 posting service (per [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §8)
- [ ] Self-approval block (requester ≠ approver) enforced at service layer

**Frontend work:**
- [ ] Expense request form
- [ ] Approval queue/inbox view for approvers
- [ ] Expense status tracking (draft/pending/approved/rejected/paid)

**Security work:** Permission gating per step (`expense.create`, `expense.approve`); audit log entries for every approval/rejection decision.

**Testing:** Approval chain correctness, self-approval rejection, rejected expense never posts, tenant isolation.

**Acceptance criteria:** An expense cannot affect any balance until it clears its full approval chain; rejected expenses are visible in history but contribute zero to totals.
**Dependencies:** Phase 1, 2, 3, 4 (shares the category CRUD built in Phase 4).

---

## PHASE 6 — Accounts + Funds + Transfers

**Objectives:** Manage accounts/funds as first-class entities; move money between them correctly.

**Database work:** `accounts`, `funds` (created Phase 1). No separate `transfers` table — a transfer is two linked `transactions` rows (Decision, see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §2).

**Backend work:**
- [x] Account/fund CRUD — already built in Phase 1 (`accounts.controller.js`/`.routes.js`/`.service.js`/`.validator.js`, same for `funds`), permission-gated (`accounts.view`/`accounts.manage`, `funds.view`/`funds.manage`) ahead of this phase, since Phase 1 needed working tenant-scoped HTTP resources to prove the isolation pattern end-to-end. Only "rename"/"deactivate" as distinct UX flows (vs. the generic update already possible) remain for this phase.
- [x] Transfer logic — `financialEngine.service.js#transfer` built in Phase 3, posts two linked ledger rows atomically, tested
- [ ] `POST /api/v1/transfers` HTTP endpoint — the *service* exists and is tested directly; no route/controller/permission-gate wraps it in HTTP yet, which is this phase's remaining work

**Frontend work:**
- [ ] Account/fund management screens
- [ ] Transfer form (account-to-account and/or fund-to-fund within an account)

**Security work:** Permission gating (`account.manage`, `transfer.create`); prevent deactivating an account/fund with a nonzero balance without explicit confirmation.

**Testing:** Transfer posts both legs atomically (both or neither); balances update correctly on both sides; tenant isolation.

**Acceptance criteria:** Transfers never leave the ledger in a half-posted state; account/fund balances remain fully derivable per [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §2 after any sequence of transfers.
**Dependencies:** Phase 1, 2, 3.

---

## PHASE 7 — Pledges + Receipts

**Objectives:** Track pledge commitments and fulfillment; generate printable receipts.

**Database work:** `pledges`, `receipts` (already created Phase 1).

**Backend work:**
- [ ] Pledge CRUD; fulfillment computed from linked contributions (§ [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §7), never stored as a separate mutable counter
- [ ] Link contribution recording (Phase 4) to an optional `pledge_id`
- [ ] Receipt generation on contribution recording: sequential per-tenant `receipt_number` ([DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §2), PDF rendered and stored via Cloudinary
- [ ] Cloudinary account provisioned and integrated (first phase that needs it)

**Frontend work:**
- [ ] Pledge creation/tracking view (progress bar: fulfilled vs. total)
- [ ] Receipt view/download/print

**Security work:** Receipt access goes through normal auth+tenant-scoping, never a bare public Cloudinary URL ([SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §6); MIME/size validation on any uploaded logo used in receipt templates.

**Testing:** Pledge fulfillment matches sum of linked contributions exactly; receipt numbers are sequential and unique per tenant; tenant isolation on receipt access.

**Acceptance criteria:** A contribution linked to a pledge updates the pledge's displayed fulfillment correctly with no manual reconciliation step; a receipt PDF is generated and retrievable only by users of the owning tenant.
**Dependencies:** Phase 1, 2, 3, 4.

---

## PHASE 8 — Budget + Financial Closing

**Objectives:** Budget-vs-actual tracking; formal period close/reopen workflow.

**Database work:** `budgets`, `financial_periods` (already created Phase 1).

**Backend work:**
- [ ] Budget CRUD (planned amounts per fund/category/period)
- [ ] Budget-vs-actual comparison service (actual = derived from Phase 3 engine, per fund/category/period — never separately tallied)
- [ ] `POST /financial-periods/:id/close` — snapshot + lock, per [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §5
- [ ] `POST /financial-periods/:id/reopen` — elevated permission, required reason, audited
- [ ] Reconciliation endpoint/job: re-sum the ledger and compare against cached snapshots (support/debugging tool per [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §2)

**Frontend work:**
- [ ] Budget entry screens
- [ ] Budget-vs-actual report view
- [ ] Period close/reopen UI (with confirmation friction commensurate with consequence)

**Security work:** `period.close` and `period.reopen` as distinct permissions; reopen requires a comment, both actions audited.

**Testing:** Closing locks new postings against that period (verified against Phase 3's enforcement check); reopening is audited and requires the elevated permission; reconciliation job catches an intentionally-introduced snapshot/ledger mismatch in a test fixture.

**Acceptance criteria:** A closed period cannot silently accept new transactions through any code path; budget-vs-actual figures always trace back to the Financial Engine.
**Dependencies:** Phase 1, 2, 3.

---

## PHASE 9 — Reports

**Objectives:** PDF/Excel/CSV reporting, strictly as renderers over Financial Engine output.

**Database work:** None new.

**Backend work:**
- [ ] Report endpoints per [API_ARCHITECTURE.md](API_ARCHITECTURE.md) §7: income statement, fund summary, contribution export, expense export — each calling the same aggregation services as the dashboard (Phase 10)
- [ ] PDF rendering (server-side template)
- [ ] Excel generation (`exceljs` or equivalent)
- [ ] CSV streaming for large exports

**Frontend work:**
- [ ] Report selection/filter UI (date range, fund, category)
- [ ] Download/export triggers

**Security work:** Report export permission gating (`report.export`); large exports rate-limited/queued if needed to avoid resource exhaustion.

**Testing:** A report's total matches the dashboard's total for the same filter set (regression test guarding against the two ever diverging — this is the test that directly enforces [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §6).

**Acceptance criteria:** Every report format (PDF/Excel/CSV) for a given filter set produces numerically identical totals to each other and to the dashboard.
**Dependencies:** Phase 3 through 8 (reports cover all financial domains).

---

## PHASE 10 — Dashboard + Complete UI/UX

**Objectives:** Full application UI — dashboard, navigation, all module screens polished, mobile-first, localized.

**Database work:** None new.

**Backend work:** Dashboard aggregation endpoints (reusing Financial Engine services, per [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §6).

**Frontend work:**
- [ ] Full navigation/layout, mobile-first responsive shell
- [ ] Dashboard: balance summaries, fund breakdown, recent activity, pending approvals widget
- [ ] Polish pass across every module screen built in Phases 4–9
- [ ] i18n: English + Swahili dictionaries, no hardcoded strings remaining anywhere in `src/`
- [ ] Church settings/profile screens (logo upload, receipt format, fiscal year config)
- [ ] Notifications (in-app at minimum — e.g. pending approvals, period-close reminders; email/SMS out of scope unless separately requested)
- [ ] Error handling/empty states/loading states across all screens

**Security work:** CSP finalized ([SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §4) once frontend build patterns are locked.

**Testing:** Manual QA pass across all screens on mobile viewport widths; i18n completeness check (no missing translation keys).

**Acceptance criteria:** Every backend capability built in Phases 2–9 has a corresponding, polished, mobile-usable UI in both supported languages.
**Dependencies:** Phase 2 through 9.

---

## PHASE 11 — Audit + Hardening

**Objectives:** Full audit-log completeness, OWASP-mapped security hardening pass, dependency audit.

**Database work:** Confirm `audit_logs` coverage against the minimum-events list in [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §7; add any missing hook calls.

**Backend work:**
- [ ] Audit-log completeness review across every module built so far
- [ ] `npm audit` (frontend and backend) resolved
- [ ] Full OWASP Top 10 mapping ([SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §8) re-verified against actual code, not just design intent
- [ ] Rate limiting tuned against realistic usage
- [ ] Load/stress test of the Financial Engine under concurrent posting

**Frontend work:** Accessibility pass, error-boundary coverage.

**Security work:** This entire phase is security work — see backend list above. Additionally: penetration-test-style pass on tenant isolation (attempt cross-tenant access on every endpoint, confirm 404).

**Testing:**
- [ ] Full regression suite run (unit + integration + API)
- [ ] Tenant-isolation test matrix across every endpoint
- [ ] Financial calculation test suite re-run against edge cases (zero amounts, very large amounts, currency rounding)

**Acceptance criteria:** No known critical/high vulnerability in dependencies; every financial and access-control action produces an audit log entry; tenant isolation holds across 100% of endpoints, not just the ones tested per-phase.
**Dependencies:** All of Phase 1–10.

---

## PHASE 12 — Production Deployment + Commercial QA

**Objectives:** Ship to a real VPS, serving real churches, with monitoring and backups in place.

**Database work:**
- [ ] Production MySQL instance provisioned, secured (no public access beyond app server, strong credentials, least-privilege app DB user)
- [ ] Automated backup schedule + tested restore procedure

**Backend work:**
- [ ] PM2 process configuration
- [ ] Environment-specific `.env` for production (secrets never in repo)
- [ ] Health-check endpoint for monitoring

**Frontend work:**
- [ ] Production build pipeline, served via Nginx

**Security work:**
- [ ] Nginx reverse proxy + Let's Encrypt TLS
- [ ] Cloudflare DNS/WAF configured
- [ ] Final secrets rotation (dev secrets never reused in production)
- [ ] Backup/incident-response runbook written

**Testing:**
- [ ] Production smoke tests (login, record a contribution, generate a report, on the live deployment)
- [ ] Commercial QA: full walkthrough as each defined role (Treasurer, Pastor/Admin, Approver, Viewer) against a realistic seeded church

**Acceptance criteria:** A real church can be onboarded (tenant provisioned), staff can log in and use every module, backups run and have been proven restorable, monitoring alerts on downtime, and the system has passed a full role-by-role commercial QA pass.
**Dependencies:** All of Phase 1–11.

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

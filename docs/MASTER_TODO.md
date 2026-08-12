# Master TODO — Clix Church Treasury Management System

Governing execution plan, Phase 0 through Phase 12. Cross-references: [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md), [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md), [API_ARCHITECTURE.md](API_ARCHITECTURE.md), [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md), [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md), [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md).

Checkboxes are updated as work genuinely completes (see [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) §8) — never batch-checked at phase end.

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

**Database work:**
- [ ] Provision a MySQL 8 instance for local development (Docker or native install)
- [ ] Build the migration runner ([DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §5)
- [ ] Write migrations for all core tables in FK-safe order: `tenants`, `church_settings`, `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `refresh_tokens`, `accounts`, `funds`, `categories`, `transactions`, `contributors`, `contributions`, `expenses`, `expense_approvals`, `transfers`, `pledges`, `receipts`, `financial_periods`, `budgets`, `audit_logs`
- [ ] Apply indexing plan ([DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §4)
- [ ] Seed data: default permissions, default system roles, one dev tenant + admin user
- [ ] Update [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) with finalized DDL detail

**Backend work:**
- [ ] `server/` package initialized, `mysql2` connection pool, config loading from `.env`
- [ ] Base repository helper enforcing `tenant_id` scoping (per [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §1)

**Frontend work:** None this phase.

**Security work:**
- [ ] `.env.example` created and kept current
- [ ] Confirm no tenant-owned repository method can execute unscoped (code review checklist item established)

**Testing:**
- [ ] Migration runner applies cleanly from empty DB and is idempotent (re-run = no-op)
- [ ] Seed script produces a working dev tenant
- [ ] Tenant-isolation test at the repository layer: querying tenant A's connection for tenant B's row returns nothing

**Acceptance criteria:** Fresh MySQL instance + `npm run migrate` (or equivalent) produces the complete schema with no manual steps; seed data present; base repository scoping helper exists and is used, not bypassed.
**Dependencies:** Phase 0.

---

## PHASE 2 — Auth + RBAC + Security

**Objectives:** Working authentication, session/refresh flow, RBAC enforcement, and the security middleware stack — as reusable infrastructure every later phase builds on.

**Database work:** None beyond what Phase 1 already created (`users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `refresh_tokens`).

**Backend work:**
- [ ] Tenant provisioning: church registration endpoint (creates `tenants` + `church_settings` row + first admin `user` in one transaction) — this is the entry point every church onboards through, so it belongs in this phase alongside auth, not deferred to deployment
- [ ] `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` ([API_ARCHITECTURE.md](API_ARCHITECTURE.md) §6)
- [ ] Password hashing (bcrypt or argon2id — finalize choice)
- [ ] JWT access token issuance + verification middleware
- [ ] Refresh token rotation + reuse detection
- [ ] `tenant-resolver` middleware
- [ ] `rbac` middleware (permission-per-route enforcement)
- [ ] `helmet()`, CORS allowlist, rate limiter, centralized error handler, validation middleware ([API_ARCHITECTURE.md](API_ARCHITECTURE.md) §3)
- [ ] Audit log service (the shared hook every later module writes through, per [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §7) — built here, before any phase has an event worth logging, so no module reinvents its own logging path
- [ ] User management endpoints: invite user, assign role, disable user
- [ ] Password reset flow (token-based, single-use, time-limited) — design + implement (flagged as not yet designed in [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §2)
- [ ] Account lockout after repeated failed logins

**Frontend work:**
- [ ] Login screen, session handling (access token in memory, refresh via cookie), protected route wrapper
- [ ] `react-router-dom` introduced here

**Security work:**
- [ ] Full §1–§5 of [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) implemented (isolation, authN, authZ, transport headers, validation/rate limiting)
- [ ] Self-approval segregation-of-duties rule scaffolded (enforced fully once Phase 5 approvals exist)

**Testing:**
- [ ] Login success/failure, lockout trigger, refresh rotation, reuse-detection
- [ ] RBAC: user without permission X gets 403 on route requiring X
- [ ] Tenant isolation at the API layer (not just repository layer): cross-tenant 404s

**Acceptance criteria:** A user can register/be invited, log in, stay authenticated across refresh, get 401/403 correctly, and no route is reachable without passing through the full middleware stack.
**Dependencies:** Phase 1.

---

## PHASE 3 — Financial Engine

**Objectives:** Build the ledger and posting/balance/reversal engine every financial module depends on — this phase is pure infrastructure, no user-facing domain feature yet, but it is the most important phase in the product.

**Database work:** `transactions` table finalized (already created in Phase 1); confirm indexing under realistic query patterns.

**Backend work:**
- [ ] Posting service: the single function that writes a `transactions` row, used by every future domain module — no module writes to `transactions` directly
- [ ] Balance calculation service (derive from ledger, per [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §2)
- [ ] Reversal service — `type = 'reversal'`, linked via `reversed_by_transaction_id` (§4)
- [ ] Adjustment service — `type = 'adjustment'`, distinct from reversal (reconciliation differences, not error corrections), per [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §4
- [ ] Period-scoping enforcement (reject posting against a closed period — full close/reopen workflow lands in Phase 8, but the *enforcement check* belongs here since every poster depends on it)
- [ ] Fund + account balance query services

**Frontend work:** None — no UI consumes this yet.

**Security work:** Posting/reversal actions require explicit permissions; no direct-edit endpoint for posted transactions exists (by omission, per [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §4).

**Testing:**
- [ ] Balance = sum of posted ledger rows, verified against hand-computed fixtures
- [ ] Reversal nets to zero, original row untouched
- [ ] Posting against a closed period is rejected
- [ ] Concurrent posting doesn't produce a race (transaction-level DB locking / `SELECT ... FOR UPDATE` where needed)

**Acceptance criteria:** Financial Engine has no consumers yet but is fully tested in isolation; every rule in [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §1–§5 has a corresponding passing test.
**Dependencies:** Phase 1, Phase 2 (for permission-gated actions).

---

## PHASE 4 — Income + Contributions

**Objectives:** Record contributions against contributors, funds, and categories; post through the Financial Engine.

**Database work:** `contributors`, `contributions` (already created Phase 1) — confirm/adjust as real usage patterns emerge.

**Backend work:**
- [ ] Contributor CRUD
- [ ] Contribution recording → posts via Phase 3 posting service
- [ ] Category management (`categories` table, both `income` and `expense` types — expense categories are used by Phase 5, but the CRUD is shared and built once here)
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

**Database work:** `accounts`, `funds`, `transfers` (already created Phase 1).

**Backend work:**
- [ ] Account/fund CRUD (create, rename, deactivate — never hard-delete once referenced by a transaction)
- [ ] Transfer endpoint: posts two linked ledger rows (debit source, credit destination) via Phase 3 engine

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

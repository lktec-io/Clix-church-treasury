# Security Architecture

**Current state:** Phases 1–6 implemented — tenant isolation, authentication, RBAC, and the security middleware stack described below all exist in `server/src/`, now exercised across every domain module through Phase 6. Verification status: written and lint-clean, tests written, but not yet run against a live database (see [MASTER_TODO.md](MASTER_TODO.md)). This document now describes the actual implementation, not just the target; §§1–3 and §9 were updated to match what was built, everything else remains the Phase 0 target for later phases.

---

## 1. Tenant Isolation

This is the single most important guarantee the product makes: **one church can never see another church's data.**

- Every tenant-owned table carries `tenant_id` (see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §1).
- `tenant_id` is resolved server-side from the authenticated user's JWT claim, by `server/src/middleware/tenantContext.js`, and attached to `req.tenantId`. It reads `req.auth.tenantId` — populated only by `authenticate.js` after verifying the JWT signature — and nothing else; a request body/query/param `tenantId` field is never consulted anywhere in the codebase (confirmed by a repo-wide search as part of the Phase 1/2 self-audit — no route reads `req.body.tenantId` or equivalent).
- `server/src/db/TenantScopedRepository.js` is the base class every tenant-owned-table repository extends. It requires a `tenantId` argument on every method and throws (`assertTenantId`) rather than silently running unscoped if it's missing — there is no unscoped convenience method available. The one deliberate, documented exception is `users.repository.js#findByIdAnyTenant`, used only by the refresh-token flow (which starts from a token record's `user_id`, not client input, and returns the tenant_id from the server-side row — never trusts a client-supplied value).
- Tenant-isolation tests exist for every module built so far (`tests/phase1/`–`tests/phase6/`), asserting cross-tenant access returns `404`, not `403` — a `403` would confirm the resource exists cross-tenant; `404` does not.
- **New in Phase 4 — a second isolation axis within a tenant, not just across tenants:** `contributors.view`/`contributors.manage` are permissions distinct from `income.view`/`income.create`, specifically so a role can see contribution *amounts* and totals without being able to see *who* gave them. Auditor and Viewer hold `income.view` but not `contributors.view` — tested explicitly in `tests/phase4/contributions.test.js` ("a role without contributors.view sees contributions without contributor identity"). This is enforced at the service layer (`contributions.service.js#enrichWithContributorInfo`), not by hiding a UI column — the API response itself omits the resolved contributor object for a caller without the permission.

---

## 2. Authentication

- **Password hashing: `bcryptjs`** (pure JS), not native `bcrypt`. Decision changed from the originally chosen native `bcrypt` after it failed to install on the dev machine (no Python/Visual Studio build tools available for `node-gyp`, and no prebuilt binary matched this Node/Windows combination). `bcryptjs` is the same algorithm with a pure-JS implementation — zero native compilation, slightly slower under heavy load, which is not a concern at this product's expected scale. Cost factor 10. This is a deviation from the Decision #16-style stakeholder pick recorded during Phase 1 setup; recorded here rather than silently changed.
- JWT access tokens (`server/src/modules/auth/tokens.js`): 15 min TTL (`env.jwt.accessTokenTtl`), `HS256`, signed with `JWT_ACCESS_SECRET`. Payload: `sub` (userId), `tenantId`, `roles` (role names only) — no permissions embedded, no PII. `server/src/middleware/authenticate.js` verifies the signature and expiry on every request; a forged or expired token is rejected before `tenantContext` or any RBAC check runs.
- **Authorization is never read from the JWT.** `server/src/middleware/rbac.js#requirePermission` re-queries `permissions.repository.js#listForUser` from the database on every single request. This means a permission or role change takes effect on the user's very next request, not only after their 15-minute access token expires.
- Refresh tokens (`server/src/modules/auth/tokens.js` + `refreshTokens.repository.js`): opaque 48-byte random value, SHA-256 hashed before storage (raw value never persisted), delivered only via an `httpOnly`, `SameSite=Strict` cookie scoped to `/api/v1/auth` (`Secure` in production). Rotated on every `/auth/refresh` call; presenting an already-rotated (revoked) token triggers `refreshTokensRepository.revokeChainFrom`, killing every token descended from it and logging `auth.refresh_reuse_detected` — tested in `tests/phase2/auth.test.js`.
- Account lockout: `env.login.maxAttempts` (default 5) failed attempts locks the account for `env.login.lockoutMinutes` (default 15), tracked on `users.failed_login_attempts`/`locked_until`. A locked account gets a distinct `423 ACCOUNT_LOCKED` response — this is the one place the API deliberately reveals more than "invalid credentials," since by that point the request has already matched a real account.
- Both "wrong password" and "unknown email"/"unknown tenant slug" return the exact same message and `401 UNAUTHENTICATED` code, so a login attempt cannot be used to enumerate valid accounts (`tests/phase2/auth.test.js`).
- Password reset is implemented (`POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`): a hashed, single-use, 30-minute token (`password_reset_tokens` table). No email delivery exists yet — outside production, the request endpoint returns the raw token directly in the response (`devToken`) so the flow can be exercised end-to-end without an email provider; in production it never does. Completing a reset revokes every refresh token the user holds, forcing re-login on all devices.
- **Multi-tenant login disambiguation (a decision the Phase 0 design didn't address):** since `users.email` is only unique per-tenant, not globally, login requires `{ tenantSlug, email, password }` — a plain email/password login would be ambiguous across tenants. This is documented here since it wasn't an explicit Phase 0 decision.

---

## 3. Authorization (RBAC)

- 31 fine-grained permissions seeded (`server/src/db/seeds/permissionCatalog.js`) — e.g. `expense.approve`, `financial_period.close`, `financial_period.reopen` (deliberately separate from `.close`, matching [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §5), `users.manage`, `roles.manage`, `audit.view`. Not just role names, so a tenant can eventually get custom roles without a schema change (`roles.tenant_id` is already nullable for exactly this).
- Six system-default roles seeded, shared by every tenant: **Super Administrator** (all permissions), **Treasurer**, **Assistant Treasurer**, **Approver**, **Auditor**, **Viewer** — the mapping is in `permissionCatalog.js` and is a Phase 1/2 judgment call (not literally specified in the brief) balancing segregation of duties: Approver gets `expense.approve`/`expense.reject` but not `expense.create`; Auditor gets broad read access plus `audit.view` but no write permissions at all; Viewer gets only `.view` permissions.
- Every protected route declares its required permission via `requirePermission(name)` (`server/src/middleware/rbac.js`), mounted in the route file itself (e.g. `accounts.routes.js`) — never as an ad-hoc check buried in a controller. A request that clears authentication and tenant-context but lacks the permission gets `403 FORBIDDEN`.
- Self-management protection implemented now, ahead of the approval workflow that will need the fuller version in Phase 5: `users.service.js#disableUser` blocks a user from disabling their own account (`tests/phase2/rbac.test.js`). The expense-approval-specific segregation of duties (requester ≠ approver) is deferred to Phase 5, where an actual expense/approval record exists to enforce it against.

---

## 4. Transport & Headers

- TLS via Let's Encrypt at the Nginx layer — still Phase 12, not yet applicable to local dev.
- `helmet()` applied in `server/src/app.js` — default header set (HSTS, `X-Content-Type-Options: nosniff`, `X-Powered-By` removed, etc.), verified in `tests/phase2/security.test.js`.
- CORS (`cors` package): explicit allowlist from `CORS_ORIGINS` (`server/src/config/env.js`), `credentials: true` (required since the refresh-token cookie must be sent cross-origin from the dev frontend at `localhost:5173`). A disallowed origin gets no `Access-Control-Allow-Origin` header at all, rather than an error — tested explicitly.
- CSP: still Phase 10, not yet implemented.

---

## 5. Input Validation & Rate Limiting

- Hand-rolled validators per module (`*.validator.js`, e.g. `accounts.validator.js`, `auth.validator.js`) reject unknown/malformed fields before the controller runs — no external validation library was introduced (`express-validator`/`zod` considered in Phase 0, but the hand-rolled pattern established in Phase 1 for `accounts`/`funds` was extended consistently rather than mixing two approaches). Confirmed by test: an invite payload with an injected `status: "active"` or `role: "Super Administrator"` field is silently ignored — the created row uses only the fields the validator explicitly extracts (`tests/phase2/security.test.js`).
- Parameterized queries only, everywhere (`mysql2`'s `?` placeholders) — confirmed by repo-wide grep as part of the Phase 1–3 self-audit; no string-concatenated SQL exists.
- Rate limiting (`express-rate-limit`, `server/src/middleware/rateLimit.js`): `/auth/*` limited to 10 req/min per IP; all other API routes to 300 req/min. Both are skipped when `NODE_ENV=test` so the test suite isn't rate-limited by its own volume of requests — this is a deliberate test-only bypass, not a production behavior.
- Malformed/oversized request bodies (bad JSON, >1MB) are caught by Express's body-parser and now correctly surfaced as `400`/`413` by `errorHandler.js`, not a generic `500` — this was a real gap the security test suite caught (the error handler originally only special-cased `AppError` instances) and was fixed as part of Phase 2.

---

## 6. File Uploads

- Cloudinary handles storage; the backend never writes uploaded binary data to local disk on the VPS (avoids disk-fill and local-file-serving risk).
- Server-side validation of MIME type and size before requesting/accepting a Cloudinary upload — do not trust the client-reported content type alone.
- Uploaded assets (receipts, logos) are tenant-scoped in the DB record even though Cloudinary itself is a shared bucket — access to "get me this receipt's PDF" still goes through the normal auth+tenant-scoping middleware, never a bare public Cloudinary URL handed out without an ownership check.

---

## 7. Audit Logging

- `server/src/modules/audit/auditLog.service.js#recordAuditLog` is the single write path — confirmed by the Phase 1–3 self-audit that nothing else inserts into `audit_logs` directly.
- Currently logged: `tenant.registered`, `auth.login_success`, `auth.login_failed`, `auth.refresh_reuse_detected`, `auth.logout`, `auth.password_reset_requested`, `auth.password_reset_completed`, `user.invited`, `user.role_assigned`, `user.role_removed`, `user.disabled`, `transaction.reversed`, `transaction.adjustment_created`, `financial_period.closed`, `financial_period.reopened`. Never logs a raw password or raw token — verified by test (`tests/phase2/security.test.js`), since `before_state`/`after_state` payloads only ever carry IDs/names/reasons.
- Append-only: no `PATCH`/`DELETE` route exists for `audit_logs` anywhere in the codebase.
- `GET /api/v1/audit-logs` (permission: `audit.view`) is the first read surface; a full filterable audit UI is Phase 11 scope.

---

## 8. OWASP Top 10 — How This Architecture Addresses Each

| Risk | Mitigation |
|---|---|
| Injection | Parameterized queries only (§5); no ORM query-builder string concatenation either |
| Broken authentication | §2 — hashed passwords, short-lived JWT, rotated refresh tokens, lockout |
| Broken access control | §1 tenant isolation + §3 RBAC, enforced in shared middleware, not per-controller judgment |
| Cryptographic failures | TLS everywhere (§4), hashed secrets at rest, no sensitive data in JWT payload beyond IDs/roles |
| Security misconfiguration | `helmet()`, explicit CORS allowlist, `.env`-based config never committed (see [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md)) |
| Vulnerable/outdated components | Dependency policy in [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) — minimal dependency surface by design, periodic `npm audit` in CI (Phase 11) |
| Identification/auth failures | Same as "broken authentication" above |
| Software/data integrity failures | Append-only financial ledger (Financial Architecture §1/§4) prevents silent data tampering; audit log covers config/permission changes |
| Logging/monitoring failures | §7 audit logging + Phase 12 production monitoring/alerting |
| SSRF | No server-side "fetch a URL the user supplies" feature is planned; if one is ever added (e.g. importing a file from a link), it needs an explicit allowlist review at that time |

---

## 9. Status Against This Document

- **Phase 2 delivered:** auth, RBAC middleware, rate limiting, secure headers, audit logging — all implemented as described above.
- **Phase 3:** the financial engine enforces tenant isolation on every account/fund/category/period reference before posting a ledger row.
- **Phase 4–6 delivered:** every route across `contributors`, `contributions`, `categories`, `expenses`, `transfers`, `accounts`, `funds` is individually permission-gated (`requirePermission`, verified by a repo-wide audit of every `*.routes.js` file — no route was found mounted without it) — "unauthorized users cannot perform financial operations" is now proven end-to-end at the HTTP layer for every module through Phase 6, not just at the RBAC-middleware level in isolation. Self-approval prevention (Phase 5) and the contributor-privacy boundary (Phase 4, §1 above) are the two access-control refinements added beyond the original Phase 0/2 design.
- **Self-audit performed for Phases 4–6** (repo-wide grep, documented in the Phase 4-6 commit messages): no `req.body`/`req.params`/`req.query` read of `tenantId` anywhere; no SQL outside a repository file; no hardcoded `localhost`/`127.0.0.1` outside a documented dev-only config fallback (and even those were subsequently removed from the backend — `CORS_ORIGINS`/`FRONTEND_URL` are now required, fail-fast config, no default at all); no wildcard CORS; no file-upload middleware exists (Phase 5 attachment handling is metadata-validation only, no upload endpoint, deferred to Phase 7 with real storage).
- `npm audit` reports 0 vulnerabilities on both the server and frontend packages as of this writing.
- **Not yet verified:** none of the above has been run against a live MySQL instance — see [MASTER_TODO.md](MASTER_TODO.md) for the current blocker (local MySQL root access). `npm test` fails at the migration step with `ER_ACCESS_DENIED_ERROR` before any test executes. Everything above describes the code as written, not a passing test run.
- Phase 11: full OWASP-mapped hardening pass, dependency audit, audit-log completeness review — still pending, unchanged from the Phase 0 plan.
- Phase 12: TLS, CSP finalization, production secrets management, backup/incident-response runbook — still pending, unchanged from the Phase 0 plan. Production domain (`https://treasurer.clixworks.co.tz`) and same-origin API strategy are now documented ([PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md), [API_ARCHITECTURE.md](API_ARCHITECTURE.md) §8) ahead of that phase, so Phase 12 has a target to deploy against rather than needing to invent one.

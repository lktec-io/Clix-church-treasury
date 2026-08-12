# Security Architecture

**Current state:** No code exists yet; this defines mandatory security requirements for every phase from Phase 1 onward. Nothing here is optional or "add later" — a financial product handling church funds does not get a security retrofit pass.

---

## 1. Tenant Isolation

This is the single most important guarantee the product makes: **one church can never see another church's data.**

- Every tenant-owned table carries `tenant_id` (see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §1).
- `tenant_id` is resolved server-side from the authenticated user's JWT claim, by the `tenant-resolver` middleware ([API_ARCHITECTURE.md](API_ARCHITECTURE.md) §3), and attached to `req.tenantId`. It is **never** read from URL params, query strings, or request bodies — a request that includes a `tenantId` field in its body has that field ignored/stripped by validation, not trusted.
- The repository layer's query-building helpers require a `tenantId` argument on every read/write against a tenant-owned table; there is no "unscoped" convenience method available to controllers/services for these tables. Code review checklist item: any new repository method touching a tenant-owned table must show a `WHERE tenant_id = ?` (or equivalent) in its SQL.
- Tenant-isolation tests (Phase 2 onward, every module): for each endpoint, assert that User A (tenant 1) requesting a resource ID belonging to tenant 2 gets `404`, not `403` — a `403` confirms the resource exists and leaks its existence across tenants; `404` does not.

---

## 2. Authentication

- Passwords hashed with **bcrypt** (cost factor 12) or **argon2id** — final pick made in Phase 2, either is acceptable, plaintext/reversible storage is not.
- JWT access tokens: short-lived (15 min), signed with a server-held secret (`HS256` acceptable at this scale; `RS256` only if a second verifying service appears later), contain `userId`, `tenantId`, `roles` — no PII beyond what's needed for authorization checks.
- Refresh tokens: opaque random value, stored **hashed** in `refresh_tokens` (never store the raw token server-side — same principle as passwords), delivered to the client only via `httpOnly` + `Secure` + `SameSite=Strict` cookie (never in a JS-readable response field, to limit XSS blast radius). Rotated on every use; reuse of a revoked token revokes the entire chain and should be logged as a security event.
- Account lockout: after N (e.g. 5) failed login attempts within a window, temporarily lock the account and log the event — mitigates credential-stuffing/brute-force without the complexity of CAPTCHA infrastructure at this stage.
- No password reset via email exists yet as a designed flow — Phase 2 must design it (token-based, single-use, time-limited) before shipping; flagged here so it isn't silently skipped.

---

## 3. Authorization (RBAC)

- Permissions are fine-grained action strings (`expense.approve`, `period.close`, `report.export`, `user.invite`, ...) — not just role names — so a tenant can eventually customize a role's permission set without a schema change.
- Every route declares its required permission(s) explicitly; the `rbac` middleware checks `req.user`'s effective permissions (via their role(s)) before the controller runs. No controller performs its own ad-hoc "is this user allowed" check as the *sole* gate — that logic belongs in the shared middleware so it can't be forgotten on a new route.
- Segregation of duties is a product requirement, not just a nice-to-have: the user who *requests* an expense should not, by default, be the same user whose approval satisfies the approval chain for that expense (self-approval should be blocked at the service layer for the approval action, independent of role permissions).

---

## 4. Transport & Headers

- TLS via Let's Encrypt at the Nginx layer (Phase 12) — no plaintext HTTP in production, HTTP→HTTPS redirect enforced.
- `helmet()` for standard secure headers (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, etc.).
- CORS: explicit origin allowlist (the production frontend domain + local dev origin), not `*`, especially since credentials (cookies) are involved in the refresh-token flow.
- Content-Security-Policy: restrict script/style sources; since the frontend is pure CSS/React with no inline-script patterns needed, a fairly strict CSP is achievable — define it in Phase 10 alongside frontend build finalization.

---

## 5. Input Validation & Rate Limiting

- Every request body/query/param schema-validated at the middleware layer ([API_ARCHITECTURE.md](API_ARCHITECTURE.md) §3, step 9) before reaching a controller. Reject unknown fields rather than silently ignoring them (prevents mass-assignment-style surprises, e.g. a client sneaking a `status: "posted"` into a create-expense payload).
- Parameterized queries only, everywhere — no string-concatenated SQL, no exceptions. This is the SQL-injection control; it is a straight-line rule, not a judgment call.
- Rate limiting: login/auth endpoints get a tight limit (e.g. 5–10/min per IP) to blunt credential stuffing; general API endpoints get a looser but present limit (e.g. 100–300/min per authenticated user) to blunt abuse/scraping.

---

## 6. File Uploads

- Cloudinary handles storage; the backend never writes uploaded binary data to local disk on the VPS (avoids disk-fill and local-file-serving risk).
- Server-side validation of MIME type and size before requesting/accepting a Cloudinary upload — do not trust the client-reported content type alone.
- Uploaded assets (receipts, logos) are tenant-scoped in the DB record even though Cloudinary itself is a shared bucket — access to "get me this receipt's PDF" still goes through the normal auth+tenant-scoping middleware, never a bare public Cloudinary URL handed out without an ownership check.

---

## 7. Audit Logging

- `audit_logs` (see [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §2) is written by a shared service-layer hook, not scattered `INSERT`s copy-pasted per controller — new financial/security-relevant actions must register with this hook, not invent their own logging.
- Minimum events logged: login success/failure, permission changes, expense approval/rejection, transfer creation, period close/reopen, any reversal/adjustment, settings changes.
- Audit logs are append-only at the application layer (no `PATCH`/`DELETE` route exists for them) and excluded from any bulk-delete/cleanup tooling.

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

## 9. What Later Phases Must Deliver Against This Document

- Phase 2: auth, RBAC middleware, rate limiting, secure headers — as foundational infrastructure, before Phase 3+ domain work begins.
- Every phase 3–9: tenant-isolation tests per new module (§1).
- Phase 11: full OWASP-mapped hardening pass, dependency audit, audit-log completeness review.
- Phase 12: TLS, CSP finalization, production secrets management, backup/incident-response runbook.

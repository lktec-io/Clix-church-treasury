# Project Architecture

**Product:** Clix Church Treasury Management System
**Company:** Clix Digital Works
**Type:** Commercial, multi-tenant SaaS for church financial management
**Status:** Phases 1–3 implemented (database/multi-tenant foundation, auth/RBAC/security, financial engine) — see [MASTER_TODO.md](MASTER_TODO.md) for exact scope. Code is written and lint-clean; live test verification against MySQL is pending local DB access.

---

## 1. Phase 0 Finding: This Is a Greenfield Build

The repository at project init contained only the unmodified output of `npm create vite@latest -- --template react`:

- `src/App.jsx` with the default Vite counter demo, default assets, default CSS
- No backend, no server code, no API of any kind
- No database connection, schema, or migrations
- No authentication, no routing (`react-router` was not even a dependency)
- No `docs/` folder, no prior architecture documentation
- No git history (repository has since been initialized — see [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md))

There is no legacy system to reverse-engineer, no duplicated logic to reconcile, and no broken features to triage. Every module described below is a **target architecture**, not a description of existing code. Phase 1 onward builds against this document; it is not an audit report.

This matters for how the rest of this doc set should be read: risks listed here are *anticipated* risks for the domain (multi-tenant financial systems), not defects found in code.

---

## 2. Technology Stack (Confirmed Direction)

No existing technology commitments were found, so the stack below is adopted as-is from the product brief, with no changes:

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite, React Router, Axios, React Icons, pure CSS (no CSS framework) |
| Backend | Node.js + Express, REST API, JWT authentication |
| Database | MySQL 8 |
| File storage | Cloudinary (receipts, church logos, exported report attachments) |
| Infrastructure | VPS, Nginx (reverse proxy + TLS termination), PM2 (process manager), Cloudflare (DNS/CDN/WAF), Let's Encrypt (TLS certs) |

Deliberately **not** introduced unless a concrete need arises later: an ORM (Prisma/Sequelize/TypeORM), a state-management library (Redux/Zustand), a UI component framework, or a CSS framework (Tailwind/Bootstrap) — the brief specifies pure CSS and the existing dependency list is minimal by design. See [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) for the dependency-addition policy.

---

## 3. Repository Layout (Decision)

**Decision:** Monorepo. Backend lives in `/server` alongside the existing `/src` frontend, in this same repository.

```
Clix church treasury/
├── src/                    # React frontend (existing)
├── server/                 # Express + MySQL backend (Phase 1+)
│   ├── src/
│   │   ├── config/         # env loading, db pool, cloudinary config
│   │   ├── middleware/     # auth, tenant-resolver, rbac, validation, error-handler, rate-limit
│   │   ├── modules/        # one folder per domain module (see §5), each with
│   │   │                   #   controller / service / repository / validator / routes
│   │   ├── db/
│   │   │   ├── migrations/ # numbered SQL migration files
│   │   │   └── seeds/
│   │   └── app.js
│   ├── tests/
│   └── package.json        # separate dependency tree from the frontend
├── docs/                   # this documentation set
├── package.json            # frontend (existing)
└── ...
```

Rationale: single VPS deployment target (PM2 + Nginx), one team, one release cadence at this stage — a split-repo adds coordination overhead (versioning, cross-repo PRs, CI wiring) with no present benefit. Revisit only if the backend needs independent scaling/deployment or a second consumer (e.g. a mobile app) appears.

---

## 4. Multi-Tenant Architecture

**Model:** Shared database, shared schema, tenant discriminator column (`tenant_id` / `church_id`) on every tenant-owned table. Not database-per-tenant, not schema-per-tenant.

Rationale: database-per-tenant and schema-per-tenant both multiply migration and connection-pool complexity linearly with tenant count, which is unjustified for a single-VPS MySQL deployment at this product's expected scale (individual churches, not enterprises). Shared-schema is the standard, well-understood approach for this scale and keeps cross-tenant reporting (for Clix Digital Works' own admin/billing views, if ever needed) simple.

**Enforcement (see [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §1 for full detail):**
- Every tenant-scoped table has a non-nullable `tenant_id` with a foreign key to `tenants`.
- A repository-layer convention requires every query to be scoped by `tenant_id` — no controller or service is permitted to run a raw query against a tenant-owned table without it.
- `tenant_id` is derived server-side from the authenticated user's JWT/session, never accepted from client-supplied request body/query parameters.
- Cross-tenant access is treated as a security incident class, not a bug class — see audit logging requirements in Phase 11.

---

## 5. Domain Modules

These map directly to Phases 3–9 in [MASTER_TODO.md](MASTER_TODO.md):

- **Tenancy & Provisioning** — church registration, tenant lifecycle, church settings/profile
- **Identity** — users, roles, permissions, authentication, sessions/refresh tokens
- **Financial Engine** — the shared ledger/posting logic every other financial module writes through (see [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md))
- **Accounts & Funds** — bank/cash accounts, restricted/unrestricted funds, transfers between them
- **Income & Contributions** — tithes, offerings, donations, contributor records
- **Expenses & Approvals** — expense requests, multi-step approval workflow, disbursement
- **Pledges & Receipts** — pledge commitments, fulfillment tracking, receipt generation/printing
- **Budgets & Periods** — budget-vs-actual, financial period open/close, period locking
- **Reporting** — PDF/Excel/CSV generation, all figures sourced from the Financial Engine, never recomputed in the frontend
- **Audit** — immutable audit log of financial and access-control events
- **Dashboard** — read-only aggregation surface over the above

---

## 6. Architectural Decisions Log

Decisions required by the product brief before coding begins. Each will be expanded in its owning document; this is the index and the one-line rationale.

| # | Decision | Choice | Detail |
|---|---|---|---|
| 1 | Tenant isolation | Shared DB/schema + enforced `tenant_id` scoping at repository layer | §4 above, [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §1 |
| 2 | Authentication | JWT access token (short-lived) + refresh token (long-lived, rotated, stored hashed) | [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §2 |
| 3 | Authorization | RBAC with role→permission mapping, permission checks at route + service layer | [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §3 |
| 4 | Financial transaction model | Append-only ledger; no in-place edits to posted transactions | [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §1 |
| 5 | Account balance calculation | Derived from ledger (sum of posted transactions), materialized snapshot cached per closed period for performance | [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §2 |
| 6 | Fund tracking | Funds are first-class, restricted vs. unrestricted flag, every transaction line tagged with a fund | [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §3 |
| 7 | Transaction immutability | Posted transactions are never UPDATE/DELETE'd; corrections go through the reversal mechanism | [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §4 |
| 8 | Reversal mechanism | A reversal is a new, linked, offsetting transaction; original stays intact for audit | [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §4 |
| 9 | Financial period closing | Closing locks new postings before the close date; reopening requires elevated permission + is itself audited | [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §5 |
| 10 | Audit trail | Append-only `audit_logs` table, written by a service-layer hook, not optional/best-effort | [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §7 |
| 11 | Reporting | All figures computed server-side by the Financial Engine; PDF/Excel/CSV are renderers over that output, never independent calculators | [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §6 |
| 12 | Localization | English + Swahili via a frontend i18n key/dictionary approach; no hardcoded user-facing strings | [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) §Localization |
| 13 | File storage | Cloudinary for receipts/logos/attachments; DB stores the returned URL + public ID only, never binary blobs | [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §6 |
| 14 | Error handling | Centralized Express error-handling middleware, consistent JSON error envelope, no stack traces leaked to clients in production | [API_ARCHITECTURE.md](API_ARCHITECTURE.md) §4 |
| 15 | API versioning | URL-prefixed, `/api/v1/...`, from day one | [API_ARCHITECTURE.md](API_ARCHITECTURE.md) §1 |
| 16 | Database migrations | **Resolved:** plain numbered SQL migration files + a small custom runner (no ORM), confirmed with stakeholder and implemented | [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §6 |
| 17 | Password hashing library | `bcryptjs` (pure JS), not native `bcrypt` — changed after `bcrypt` failed to install (no build tools for `node-gyp` on the dev machine) | [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §2 |
| 18 | Multi-tenant login | Login requires `{ tenantSlug, email, password }` since `users.email` is only unique per-tenant, not globally — a decision the original brief didn't address | [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §2 |
| 19 | Ledger transaction direction | Added a `direction` (`in`/`out`) column to `transactions`, beyond the original schema sketch — `type` alone can't disambiguate a transfer's two legs | [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §7, [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §2 |
| 20 | Domain table sequencing | `contributors`/`contributions`/`expenses`/`pledges`/`receipts`/`budgets` deferred to their owning phases (4–8) rather than created upfront in Phase 1 — avoids empty, unused schema sitting around for several phases | [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) §2 |

---

## 7. Documentation Set

| Document | Purpose |
|---|---|
| [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) | This file — system-level overview and decision index |
| [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) | Target schema, relationships, migration strategy |
| [API_ARCHITECTURE.md](API_ARCHITECTURE.md) | REST conventions, endpoint map, middleware stack |
| [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) | Tenant isolation, authN/authZ, OWASP mapping, hardening |
| [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) | Ledger model, balance/fund/period/reversal rules |
| [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) | Coding conventions, dependency policy, definition of done |
| [MASTER_TODO.md](MASTER_TODO.md) | Phase 0–12 execution plan with acceptance criteria |

---

## 8. Open Items

1. **Live MySQL access is the current blocker.** A local `MySQL80` Windows service exists but the root password is unknown to the user; a dedicated least-privilege app user/database pair has been prepared (`server/scripts/setup-db.example.sql`) and is ready to run the moment root access is restored. Nothing in Phases 1–3 has been executed against a real database yet — see [MASTER_TODO.md](MASTER_TODO.md) for exact status.
2. **Cloudinary account** — not yet provisioned; only required starting Phase 7 (Receipts), not a current blocker.
3. **VPS/Nginx/PM2/Cloudflare targets** — not yet provisioned; only required at Phase 12, not a blocker for earlier phases.

Item 1 blocks *verifying* Phases 1–3 (running migrations/seeds/tests) but has not blocked *writing* them — all code and tests for Phases 1–3 exist and are lint-clean.

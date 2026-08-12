# API Architecture

**Style:** REST over HTTPS, JSON only.
**Current state:** Phases 1–6 implemented — every endpoint in §2 below marked without a "(planned)" tag is real, lint-clean code in `server/src/`. Live verification against a database is pending (see [MASTER_TODO.md](MASTER_TODO.md)).

---

## 1. Versioning

All routes prefixed `/api/v1/...` from the first endpoint written. A breaking change gets `/api/v2/...` alongside the old version rather than mutating it in place — treasurers' existing integrations (if any emerge later, e.g. a mobile app) must not break silently.

---

## 2. URL Structure

Resource-oriented, nested only where ownership is strict and always tenant-implicit (never in the URL — tenant comes from the authenticated session, see [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §1):

```
POST   /api/v1/auth/register-tenant
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me                          — the one authenticated route in this file; recovers session after a page reload
POST   /api/v1/auth/password-reset/request
POST   /api/v1/auth/password-reset/confirm

GET    /api/v1/users
POST   /api/v1/users                            — invite
POST   /api/v1/users/:id/roles
DELETE /api/v1/users/:id/roles/:roleId
POST   /api/v1/users/:id/disable

GET    /api/v1/accounts
POST   /api/v1/accounts
GET    /api/v1/accounts/:id
PATCH  /api/v1/accounts/:id                     — rename
POST   /api/v1/accounts/:id/activate
POST   /api/v1/accounts/:id/deactivate

GET    /api/v1/funds
POST   /api/v1/funds
GET    /api/v1/funds/:id
PATCH  /api/v1/funds/:id
POST   /api/v1/funds/:id/activate
POST   /api/v1/funds/:id/deactivate

GET    /api/v1/categories?type=income|expense
POST   /api/v1/categories

GET    /api/v1/contributors
POST   /api/v1/contributors
GET    /api/v1/contributors/:id

GET    /api/v1/contributions
POST   /api/v1/contributions
GET    /api/v1/contributions/:id
PATCH  /api/v1/contributions/:id                — non-financial fields only, see FINANCIAL_ARCHITECTURE.md §4
POST   /api/v1/contributions/:id/reverse

GET    /api/v1/expenses
POST   /api/v1/expenses
GET    /api/v1/expenses/:id
PATCH  /api/v1/expenses/:id                     — draft only
POST   /api/v1/expenses/:id/submit
POST   /api/v1/expenses/:id/approve
POST   /api/v1/expenses/:id/reject
POST   /api/v1/expenses/:id/return              — return for correction (submitted → draft)
POST   /api/v1/expenses/:id/pay

GET    /api/v1/transfers
POST   /api/v1/transfers
GET    /api/v1/transfers/:id

GET    /api/v1/audit-logs

--- planned, not yet built (Phase 7+) ---
GET    /api/v1/pledges
POST   /api/v1/pledges
GET    /api/v1/receipts/:id/pdf
GET    /api/v1/budgets
GET    /api/v1/financial-periods
POST   /api/v1/financial-periods/:id/close      — service exists (Phase 3), no HTTP route yet
POST   /api/v1/financial-periods/:id/reopen     — service exists (Phase 3), no HTTP route yet
GET    /api/v1/reports/income-statement
GET    /api/v1/reports/fund-summary
GET    /api/v1/reports/contributions.csv
GET    /api/v1/reports/income-statement.pdf
GET    /api/v1/settings
PATCH  /api/v1/settings
```

No verbs in URLs except for actions that aren't plain CRUD on the resource (`approve`, `reject`, `close`, `reopen`) — those are legitimate state-transition endpoints, not an excuse for RPC-style sprawl.

---

## 3. Middleware Stack (Order Matters)

```
1. helmet()                      — secure headers
2. cors()                        — allowlisted origins only, credentialed
3. express.json({ limit: '1mb' }) + cookieParser()
4. rate limiter                  — see SECURITY_ARCHITECTURE.md §5
5. authenticate middleware        — verifies JWT, attaches req.auth = { userId, tenantId, roles }
6. tenantContext middleware      — derives req.tenantId from req.auth, NEVER from params/body
7. rbac middleware (requirePermission) — per-route permission check, mounted in each module's own routes.js
8. hand-rolled validators         — schema-validates req.body/query/params inside each controller, before the service runs
9. controller → service → repository
10. centralized error handler     — last, catches everything, formats envelope; also normalizes body-parser 4xx errors (see SECURITY_ARCHITECTURE.md §5)
```

As implemented (`server/src/app.js`): steps 5–7 are non-negotiable on every route except the `/api/v1/auth/*` routes that must be reachable pre-authentication (`register-tenant`, `login`, `refresh`, `logout`, `password-reset/*`) and `/health`. `GET /auth/me` is the one route inside `auth.routes.js` that opts back into the full 5–7 chain, since it exists specifically to answer "who is authenticated right now."

---

## 4. Response Envelope

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "pageSize": 25, "total": 118 }
}
```
`meta` present only on paginated list endpoints.

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "amount must be a positive decimal",
    "fields": { "amount": "must be a positive decimal" }
  }
}
```
Production responses never include stack traces or raw DB error text (see Decision #14 in [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md)). `code` is a stable machine-readable string the frontend can switch on; `message` is human-readable and localized where feasible.

Standard `code` values: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` (e.g. closing an already-closed period), `PERIOD_LOCKED`, `RATE_LIMITED`, `INTERNAL_ERROR`.

---

## 5. Pagination, Filtering, Sorting

- `?page=1&pageSize=25` (default 25, max 100).
- `?sort=-created_at` (`-` prefix = descending).
- Filtering via explicit query params per resource (`?fundId=3&status=posted&from=2026-01-01&to=2026-03-31`), not a generic query language — keeps validation and SQL construction predictable and injection-safe.

---

## 6. Auth Flow

1. `POST /auth/login` — `{ tenantSlug, email, password }` (tenant slug required — `users.email` is only unique per-tenant, not globally, see [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §2) → short-lived access token (15 min, JWT, returned in response body) + refresh token (7–30 days, returned as an `httpOnly`, `Secure`, `SameSite=Strict` cookie scoped to `/api/v1/auth`, hashed before storage per [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) `refresh_tokens`).
2. Every subsequent request: `Authorization: Bearer <access token>`.
3. `POST /auth/refresh` — reads the refresh cookie, validates against `refresh_tokens`, issues a new access token and **rotates** the refresh token (old one revoked, new one chained via `replaced_by_token_id`) — detects reuse of a revoked token as a signal of theft.
4. `POST /auth/logout` — revokes the current refresh token.
5. `GET /auth/me` — returns `{ user, roles, permissions }` for the caller. The frontend's access token lives in memory only (never `localStorage`, to limit XSS blast radius — `src/api/client.js`), so a page reload has nothing to restore a session from except the refresh cookie: the client calls `/auth/refresh` for a new access token, then `/auth/me` to recover who's logged in and what they can do.

Full detail and rationale in [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §2.

---

## 7. Report Endpoints

Report endpoints (`/reports/*`) are **read-only views over Financial Engine output** — they call the same aggregation services the dashboard uses, then a format-specific renderer (PDF via a server-side template, Excel/CSV via streamed generation). A report endpoint never runs its own bespoke SQL that recomputes a total differently from the dashboard — see [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §6, this is the architectural principle that prevents the dashboard and the PDF report from ever disagreeing.

---

## 8. Production

The one and only production domain for this product is **`https://treasurer.clixworks.co.tz`** (docs/PROJECT_ARCHITECTURE.md) — never localhost, 127.0.0.1, example.com, or an old Clix project domain in any production configuration path.

- **Frontend:** served as static build output from `https://treasurer.clixworks.co.tz`.
- **API:** `https://treasurer.clixworks.co.tz/api/v1` — same origin as the frontend. Nginx routes `/api/*` to this Node process (PM2-managed) and everything else to the built frontend files. Same-origin means the browser doesn't even need a CORS grant for the app's own requests; `CORS_ORIGINS` is still configured explicitly (never `*`) as defense-in-depth and for any future non-browser/separate-origin client (`server/.env.example`).
- **Environment injection:** production secrets (DB credentials, `JWT_ACCESS_SECRET`) are injected directly into the server process's environment at deploy time (PM2 ecosystem config or the host's secret manager) — never written into a committed file. `server/.env.example` and the frontend's `.env.example` document every required variable name with a placeholder only.
- **Fail-fast config:** `server/src/config/env.js` treats `CORS_ORIGINS` and `FRONTEND_URL` (along with the DB/JWT settings) as required — the server refuses to start rather than silently falling back to a development default if either is missing in production.
- **Frontend API base URL:** `VITE_API_BASE_URL`, baked in at build time (Vite convention). Production build uses `https://treasurer.clixworks.co.tz/api/v1`; local dev uses `http://localhost:4000/api/v1`. See the frontend's `.env.example`.

---

## 9. What Later Phases Must Deliver Against This Document

- Phase 7–9: `pledges`, `receipts`, `budgets`, `financial-periods` (close/reopen HTTP routes — the underlying service already exists), `reports/*` endpoints, following §2's URL map and §7's renderer-only principle for reports.
- Phase 12: TLS termination and the Nginx routing described in §8, exercised against the real production domain for the first time.

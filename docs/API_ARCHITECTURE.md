# API Architecture

**Style:** REST over HTTPS, JSON only.
**Current state:** No API exists yet. This document defines the target conventions Phase 1+ backend work must follow.

---

## 1. Versioning

All routes prefixed `/api/v1/...` from the first endpoint written. A breaking change gets `/api/v2/...` alongside the old version rather than mutating it in place — treasurers' existing integrations (if any emerge later, e.g. a mobile app) must not break silently.

---

## 2. URL Structure

Resource-oriented, nested only where ownership is strict and always tenant-implicit (never in the URL — tenant comes from the authenticated session, see [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §1):

```
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout

GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/:id
PATCH  /api/v1/users/:id
POST   /api/v1/users/:id/roles

GET    /api/v1/accounts
POST   /api/v1/accounts
GET    /api/v1/funds
POST   /api/v1/funds

GET    /api/v1/contributions
POST   /api/v1/contributions
GET    /api/v1/contributions/:id

GET    /api/v1/expenses
POST   /api/v1/expenses
POST   /api/v1/expenses/:id/approve
POST   /api/v1/expenses/:id/reject

POST   /api/v1/transfers

GET    /api/v1/pledges
POST   /api/v1/pledges
GET    /api/v1/receipts/:id/pdf

GET    /api/v1/budgets
GET    /api/v1/financial-periods
POST   /api/v1/financial-periods/:id/close
POST   /api/v1/financial-periods/:id/reopen

GET    /api/v1/reports/income-statement
GET    /api/v1/reports/fund-summary
GET    /api/v1/reports/contributions.csv
GET    /api/v1/reports/income-statement.pdf

GET    /api/v1/audit-logs

GET    /api/v1/settings
PATCH  /api/v1/settings
```

No verbs in URLs except for actions that aren't plain CRUD on the resource (`approve`, `reject`, `close`, `reopen`) — those are legitimate state-transition endpoints, not an excuse for RPC-style sprawl.

---

## 3. Middleware Stack (Order Matters)

```
1. helmet()                      — secure headers
2. cors()                        — allowlisted origins only
3. express.json({ limit })       — body parsing, size-capped
4. request-id + request logger
5. rate limiter                  — see SECURITY_ARCHITECTURE.md §5
6. auth middleware                — verifies JWT, attaches req.user
7. tenant-resolver middleware    — derives req.tenantId from req.user, NEVER from params/body
8. rbac middleware                — per-route permission check
9. validation middleware          — schema-validates req.body/query/params, rejects before controller
10. controller → service → repository
11. centralized error handler     — last, catches everything, formats envelope
```

Steps 6–9 are non-negotiable on every route except `/auth/login`, `/auth/refresh`, and `/health`.

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

1. `POST /auth/login` — email + password → short-lived access token (15 min, JWT, returned in response body) + refresh token (7–30 days, returned as an `httpOnly`, `Secure`, `SameSite=Strict` cookie, hashed before storage per [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) `refresh_tokens`).
2. Every subsequent request: `Authorization: Bearer <access token>`.
3. `POST /auth/refresh` — reads the refresh cookie, validates against `refresh_tokens`, issues a new access token and **rotates** the refresh token (old one revoked, new one chained via `replaced_by_token_id`) — detects reuse of a revoked token as a signal of theft.
4. `POST /auth/logout` — revokes the current refresh token.

Full detail and rationale in [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §2.

---

## 7. Report Endpoints

Report endpoints (`/reports/*`) are **read-only views over Financial Engine output** — they call the same aggregation services the dashboard uses, then a format-specific renderer (PDF via a server-side template, Excel/CSV via streamed generation). A report endpoint never runs its own bespoke SQL that recomputes a total differently from the dashboard — see [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §6, this is the architectural principle that prevents the dashboard and the PDF report from ever disagreeing.

---

## 8. What Later Phases Must Deliver Against This Document

- Phase 2: auth endpoints + middleware stack (items 1–9 above) as reusable infrastructure before any domain route is built.
- Phase 3–9: one `routes.js` + controller + service + repository + validator per module, following §2's URL map.
- Phase 9: report endpoints built strictly as renderers over Financial Engine services, per §7.

# Database Architecture

**Engine:** MySQL 8
**Current state:** No database exists yet. Nothing in this document has been executed. This is the target schema Phase 1 will implement.

---

## 1. Conventions

- Table names: `snake_case`, plural (`churches`, `income_transactions`).
- Primary keys: `id BIGINT UNSIGNED AUTO_INCREMENT`.
- Every tenant-owned table: `tenant_id BIGINT UNSIGNED NOT NULL` → FK to `tenants.id`, indexed (usually as the leading column of a composite index alongside the table's main lookup pattern).
- Timestamps: `created_at`, `updated_at` (`DATETIME`, UTC, app-set — not relying on MySQL `ON UPDATE CURRENT_TIMESTAMP` so the app controls audit-relevant timing consistently).
- Money: `DECIMAL(14,2)`, never `FLOAT`/`DOUBLE`. Currency is a per-tenant setting (`churches.base_currency`), not per-row, for v1 — multi-currency-per-church is out of scope until a real requirement appears.
- Soft state, not soft delete, for financial rows: financial tables use a `status` enum and never a `deleted_at` — see [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §4 for why. Non-financial reference data (e.g. a category) may use `is_active` to retire it without breaking historical FK references.
- Foreign keys use `RESTRICT` on delete for anything referenced by financial rows (never cascade-delete a fund/account/category that transactions point to).

---

## 2. Core Tables (Conceptual — DDL written in Phase 1)

### Tenancy & Identity
- **`tenants`** — one row per church. `name`, `subdomain`/`slug`, `base_currency`, `locale_default` (`en`/`sw`), `status` (active/suspended), `created_at`.
- **`church_settings`** — 1:1 with `tenants`. Logo URL (Cloudinary), address, contact info, fiscal-year-start, receipt numbering format, report letterhead fields.
- **`users`** — `tenant_id`, `email` (unique per tenant, not globally), `password_hash`, `full_name`, `status` (active/invited/disabled), `last_login_at`. A user belongs to exactly one tenant (no cross-church user accounts in v1 — a treasurer serving two churches gets two accounts; revisit only if real demand appears).
- **`roles`** — `tenant_id` nullable (NULL = system-defined default role available to all tenants, e.g. "Treasurer", "Pastor", "Viewer"; non-null = tenant-custom role).
- **`permissions`** — global, not tenant-scoped (`income.create`, `expense.approve`, `period.close`, `report.export`, etc.).
- **`role_permissions`** — join table.
- **`user_roles`** — join table (a user can hold more than one role).
- **`refresh_tokens`** — `user_id`, `token_hash` (never store raw token), `expires_at`, `revoked_at`, `replaced_by_token_id` (rotation chain).

### Financial Engine (the shared ledger — see [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md))
- **`accounts`** — `tenant_id`, `name` (e.g. "Main Bank Account", "Petty Cash"), `type` (bank/cash/mobile-money), `is_active`. No stored `balance` column — balance is always derived (§ below).
- **`funds`** — `tenant_id`, `name` (e.g. "Building Fund", "General Fund", "Missions"), `is_restricted` (bool), `is_active`.
- **`categories`** — `tenant_id`, `type` (income/expense), `name`, `is_active`. Used to classify income/expense lines for reporting.
- **`transactions`** — the ledger. `tenant_id`, `type` (income/expense/transfer/reversal/adjustment), `account_id`, `fund_id`, `category_id` (nullable for transfers), `amount` (always positive; direction implied by `type`), `financial_period_id`, `status` (draft/pending_approval/posted/rejected/reversed), `reference_type` + `reference_id` (polymorphic link back to the originating `contributions`/`expenses`/`transfers`/`pledges` row), `posted_at`, `reversed_by_transaction_id` (nullable, self-referencing), `created_by_user_id`.
  - This table is the single source of truth for every balance and report. Domain tables (`incomes`, `expenses`, `transfers`) hold the domain-specific detail and each posts exactly one (or more, for split transactions) row here when approved.

### Income & Contributions
- **`contributors`** — `tenant_id`, `full_name`, `phone`, `email`, `member_number` (nullable — supports anonymous/one-off givers too).
- **`contributions`** — `tenant_id`, `contributor_id` (nullable), `fund_id`, `category_id`, `amount`, `method` (cash/mobile-money/bank/cheque), `contribution_date`, `pledge_id` (nullable, links fulfillment to a pledge), `transaction_id` (FK to the posted ledger row), `recorded_by_user_id`.

### Expenses & Approvals
- **`expenses`** — `tenant_id`, `fund_id`, `account_id`, `category_id`, `amount`, `description`, `vendor`, `status` (draft/pending_approval/approved/rejected/paid), `requested_by_user_id`, `transaction_id` (nullable until posted).
- **`expense_approvals`** — `expense_id`, `approver_user_id`, `step_order`, `decision` (approved/rejected), `decided_at`, `comment`. Supports multi-step approval chains.

### Accounts & Funds
- **`transfers`** — `tenant_id`, `from_account_id`, `to_account_id`, `from_fund_id`, `to_fund_id`, `amount`, `reason`, `transaction_id` pair (a transfer posts two linked ledger rows: a debit from source, a credit to destination).

### Pledges & Receipts
- **`pledges`** — `tenant_id`, `contributor_id`, `fund_id`, `total_amount`, `start_date`, `end_date`, `status` (active/fulfilled/cancelled). Fulfillment = sum of linked `contributions.amount` where `pledge_id` matches; not a separately maintained counter.
- **`receipts`** — `tenant_id`, `contribution_id`, `receipt_number` (per-tenant sequential, format from `church_settings`), `issued_at`, `pdf_url` (Cloudinary), `issued_by_user_id`.

### Budgets & Periods
- **`financial_periods`** — `tenant_id`, `label` (e.g. "FY2026" or "2026-Q1" depending on church's cadence), `start_date`, `end_date`, `status` (open/closed), `closed_by_user_id`, `closed_at`, `reopened_at` (nullable, audited).
- **`budgets`** — `tenant_id`, `financial_period_id`, `fund_id`, `category_id`, `planned_amount`.

### Audit
- **`audit_logs`** — `tenant_id` (nullable for platform-level events), `actor_user_id`, `action` (e.g. `expense.approve`, `period.close`, `user.role_change`), `entity_type`, `entity_id`, `before_state` (JSON, nullable), `after_state` (JSON, nullable), `ip_address`, `created_at`. Append-only — no update/delete path exists in the application layer.

---

## 3. Key Relationships

```
tenants 1──* users
tenants 1──* accounts, funds, categories
tenants 1──* contributors, pledges
tenants 1──* financial_periods

users *──* roles (via user_roles)
roles *──* permissions (via role_permissions)

contributions *──1 accounts (via posted transaction), *──1 funds, *──0..1 pledges
expenses *──1 accounts, *──1 funds, 1──* expense_approvals
transfers *──2 accounts (from/to), *──2 funds (from/to)

contributions, expenses, transfers  ──►  transactions (each posts ≥1 ledger row)
transactions *──1 financial_periods
transactions 0..1──1 transactions (reversal self-reference)

budgets *──1 financial_periods, *──1 funds, *──1 categories
receipts 1──1 contributions
```

---

## 4. Indexing Plan (Phase 1 detail, noted now so it isn't forgotten)

- `(tenant_id, status)` on `transactions`, `expenses`, `contributions` — every list/report query filters by tenant + status first.
- `(tenant_id, financial_period_id)` on `transactions` — period-scoped reports are the most common report shape.
- `(tenant_id, created_at)` or `(tenant_id, contribution_date)` — date-range queries are near-universal in financial reporting.
- Unique constraint on `(tenant_id, email)` on `users` — tenant-scoped uniqueness, not global.
- Unique constraint on `(tenant_id, receipt_number)` on `receipts`.

---

## 5. Migration Strategy (Decision — flagged for stakeholder confirmation)

**Proposed:** Plain, numbered, hand-written SQL migration files (`server/src/db/migrations/0001_create_tenants.sql`, `0002_create_users.sql`, ...) applied by a small custom Node runner that tracks applied migrations in a `schema_migrations` table. No ORM.

**Why not an ORM (Sequelize/Prisma/TypeORM):** the stack was deliberately chosen minimal (plain Express, plain `mysql2`), the financial-integrity requirement (§ append-only ledger, computed balances) is easier to reason about and audit in hand-written SQL than through an ORM's abstraction, and the team has not indicated ORM familiarity as a constraint either way. This keeps the query layer transparent for a financial product where every calculation must be traceable.

**Trade-off acknowledged:** hand-written SQL means more boilerplate for repetitive CRUD and no auto-generated migrations from schema diffs. If this becomes a real velocity problem in Phase 1, `Knex.js` (query builder + migration runner, not a full ORM) is the fallback — it doesn't hide SQL the way a full ORM does. **This is Decision #16 from [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) and should be confirmed before Phase 1 migration work starts.**

---

## 6. What Phase 1 Must Deliver Against This Document

- Actual `.sql` migration files implementing every table above, in FK-safe dependency order.
- The migration runner.
- Seed data: default `permissions` rows, default system `roles` (Treasurer, Pastor/Admin, Approver, Viewer), one seed tenant + admin user for local development.
- This document updated with the finalized DDL details (column types, exact constraint names) once written — this file currently documents *intent*, Phase 1 output is the *record*.

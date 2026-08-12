# Database Architecture

**Engine:** MySQL 8
**Current state:** Phases 1–6 implemented — foundation, auth/RBAC, financial ledger, and now the income/expense/transfer domain schema all exist as real migration files in `server/src/db/migrations/` (0001–0020). Only `pledges`, `receipts` (Phase 7) and `budgets` (Phase 8) remain undelivered — still target schema, noted as "planned" below.

**Verification status:** Migrations, seeds, and the full test suite are written but have not yet been executed against a live MySQL instance — local DB access was still being set up as of this writing (see [MASTER_TODO.md](MASTER_TODO.md) for the current blocker). Every claim below describes what the migration files actually contain, not what has been proven to run.

---

## 1. Conventions

- Table names: `snake_case`, plural.
- Primary keys: `id BIGINT UNSIGNED AUTO_INCREMENT`.
- Every tenant-owned table: `tenant_id BIGINT UNSIGNED NOT NULL` → FK to `tenants.id` (`ON DELETE RESTRICT`), indexed.
- Timestamps: `created_at`, `updated_at` (`DATETIME`, app-set via `server/src/db/time.js#nowSql()` — never `ON UPDATE CURRENT_TIMESTAMP`, so the application controls audit-relevant timing consistently, and every repository insert/update goes through the same helper).
- Money: `DECIMAL(14,2)`. The `mysql2` pool is configured with `decimalNumbers: false` (`server/src/config/db.js`), so DECIMAL columns come back as strings, never JS numbers — money never touches floating-point arithmetic anywhere in the codebase. `SUM()` aggregates are computed by MySQL itself over the DECIMAL column and passed through as strings unchanged (`server/src/modules/financial/money.js`). The API layer goes further: it requires `amount` to be submitted as a decimal **string** (e.g. `"100.50"`), rejecting a JSON number outright, so an amount is never parsed through an IEEE-754 double at any layer.
- Soft state, not soft delete, for financial rows: `transactions.status` is an enum: never a `deleted_at`. Non-financial reference data (`accounts`, `funds`, `categories`) uses `is_active` to retire a row without breaking historical FK references from posted transactions.
- Foreign keys use `RESTRICT` on delete for anything a financial row can reference (`accounts`, `funds`, `categories`, `financial_periods`, `tenants` itself) — never cascade-delete something a ledger row points to. Pure join tables (`role_permissions`, `user_roles`) and non-financial link tables (`refresh_tokens`, `password_reset_tokens`) use `CASCADE`/`SET NULL` where losing the link is harmless.

---

## 2. Tables — Implemented (Phases 1–3)

All in `server/src/db/migrations/`, one `.up.sql`/`.down.sql` pair per table, applied in this order:

### Tenancy & Platform (Phase 1)
- **`tenants`** (`0001`) — `name`, `slug` (unique), `base_currency` (default `TZS`), `locale_default` (`en`/`sw`), `status` (`active`/`suspended`).
- **`church_settings`** (`0002`) — 1:1 with `tenants` (`UNIQUE(tenant_id)`). `logo_url`, `address`, `phone`, `email`, `fiscal_year_start_month`, `receipt_number_format`.
- **`system_settings`** (`0003`) — platform-wide key/value config, not tenant-scoped. `setting_key` (unique), `setting_value`.

### Identity & RBAC (Phase 1 schema, Phase 2 logic)
- **`permissions`** (`0004`) — global. `name` (unique, e.g. `expense.approve`), `description`. 31 rows seeded — see `server/src/db/seeds/permissionCatalog.js`.
- **`users`** (`0005`) — `tenant_id`, `email` (`UNIQUE(tenant_id, email)` — tenant-scoped, not global), `password_hash`, `full_name`, `status` (`active`/`invited`/`disabled`), `last_login_at`. Phase 2 added `failed_login_attempts`, `locked_until` (`0016`).
- **`roles`** (`0006`) — `tenant_id` **nullable** (`NULL` = system-default role shared by every tenant; non-null = a tenant's own custom role). `UNIQUE(tenant_id, name)`. Note: MySQL treats every `NULL` as distinct in a unique index, so this constraint does **not** stop two system-default rows from colliding on name — uniqueness among system roles is guaranteed by the seed script being idempotent (checks existence before inserting), documented in the migration file itself.
- **`role_permissions`** (`0007`) / **`user_roles`** (`0008`) — join tables, `CASCADE` on delete.
- **`refresh_tokens`** (`0009`) — `user_id`, `token_hash` (SHA-256 hex, unique — raw token never stored), `expires_at`, `revoked_at`, `replaced_by_token_id` (self-referencing rotation chain).
- **`password_reset_tokens`** (`0017`, Phase 2) — same hashed-token pattern as refresh tokens. Doubles as the "accept invite" mechanism (`users.service.js#inviteUser`).

### Financial Foundation (Phase 1 schema, Phase 3 engine)
- **`accounts`** (`0010`) — `tenant_id`, `name` (`UNIQUE(tenant_id, name)`), `type` (`bank`/`cash`/`mobile_money`), `is_active`. No stored balance column — always derived, see §5.
- **`funds`** (`0011`) — `tenant_id`, `name` (`UNIQUE(tenant_id, name)`), `is_restricted`, `is_active`.
- **`categories`** (`0012`) — `tenant_id`, `type` (`income`/`expense`), `name` (`UNIQUE(tenant_id, type, name)`), `is_active`.
- **`financial_periods`** (`0013`) — `tenant_id`, `label` (`UNIQUE(tenant_id, label)`), `start_date`, `end_date` (`CHECK(end_date >= start_date)`), `status` (`open`/`closed`), `closed_by_user_id`, `closed_at`, `reopened_at`.
- **`transactions`** (`0014`) — the ledger, and the single source of truth for every balance. `tenant_id`, `transaction_number` (`UNIQUE(tenant_id, transaction_number)`), `type` (`income`/`expense`/`transfer`/`reversal`/`adjustment`), **`direction`** (`in`/`out` — added beyond the original Phase 0 design; see §5 for why `type` alone can't disambiguate a transfer's two legs), `account_id`, `fund_id`, `category_id` (nullable — transfers have none), `financial_period_id`, `amount` (`CHECK(amount > 0)`), `payment_method`, `reference_type`/`reference_id` (polymorphic — links a transfer's two legs to each other, or a reversal back to its original), `description`, `status` (`draft`/`pending_approval`/`posted`/`rejected`/`reversed`), `reversed_by_transaction_id` (self-referencing), `posted_at`, `created_by_user_id`. Indexed on `(tenant_id, status)`, `(tenant_id, financial_period_id)`, `(tenant_id, account_id)`, `(tenant_id, fund_id)`, `(tenant_id, created_at)`, `(reference_type, reference_id)`.

### Audit (Phase 1 schema, Phase 2 writer)
- **`audit_logs`** (`0015`) — `tenant_id` (nullable, for platform-level events), `actor_user_id` (nullable — `SET NULL` on user delete), `action`, `entity_type`, `entity_id`, `before_state`/`after_state` (JSON), `ip_address`, `created_at`. Append-only: no UPDATE/DELETE route exists anywhere in the application. Written exclusively through `server/src/modules/audit/auditLog.service.js#recordAuditLog` — no module writes to this table directly.

### Income & Contributions (Phase 4)
- **`contributors`** (`0018`) — `tenant_id`, `full_name`, `phone`, `email`, `member_number` (`UNIQUE(tenant_id, member_number)`, nullable — supports anonymous/one-off givers), `is_active`. Deliberately its own table, separate from `contributions`, so contributor-identity visibility can be permissioned independently of income-amount visibility — see [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §3.
- **`contributions`** (`0019`) — `tenant_id`, `contributor_id` (nullable, `RESTRICT`), `account_id`/`fund_id`/`category_id` (`RESTRICT`), `transaction_id` (`UNIQUE`, `RESTRICT` — the posted ledger row this contribution produced), `amount`/`payment_method`/`contribution_date`/`reference`/`notes`, `status` (`posted`/`reversed`, denormalized from the linked transaction purely for cheap listing — never edited independently of it), `recorded_by_user_id`. `amount` here is also denormalized from `transactions.amount` for the same reason.

### Expenses (Phase 5)
- **`expenses`** (`0020`) — `tenant_id`, `expense_number` (`UNIQUE(tenant_id, expense_number)`), `category_id`/`fund_id`/`account_id` (`RESTRICT`), `amount`, `payee`, `description`, `payment_method`, `reference`, `attachment_mime`/`attachment_size_bytes`/`attachment_url` (metadata only — no file storage integration until Phase 7), `status` (`draft`/`submitted`/`approved`/`rejected`/`paid`), `requested_by_user_id`, `approved_by_user_id`/`approval_date`, `rejected_by_user_id`/`rejection_reason`, `paid_by_user_id`/`payment_date`, `transaction_id` (`UNIQUE`, nullable until `paid` — the only status with a ledger effect). **Scope decision:** no separate `expense_approvals` chain table — this phase's brief specifies a single approve/reject decision, so those columns live directly on `expenses`; a multi-approver chain is a natural future extension, not built speculatively now.

**What changed from the original Phase 0 plan:** `pledges`, `receipts`, and `budgets` remain undelivered (Phase 7/8). `expense_approvals` was scoped out per the Phase 5 decision above. `transfers` is not, and was never planned to be, a separate table — a transfer is two linked rows in `transactions` (see [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §3); Phase 6 confirmed this holds and added only a thin HTTP-facing service (`transfers.service.js`) with no table of its own.

---

## 3. Tables — Planned (Phase 7+, not yet created)

- `pledges`, `receipts` (Phase 7)
- `budgets` (Phase 8)

Column sketches for these are unchanged from the original Phase 0 design and will be finalized in each owning phase's own migration.

---

## 4. Key Relationships (as implemented)

```
tenants 1──* users, church_settings(1:1), accounts, funds, categories, financial_periods
tenants 1──* transactions, audit_logs, refresh_tokens (via users), password_reset_tokens (via users)
tenants 1──* contributors, contributions, expenses

users *──* roles (via user_roles)
roles *──* permissions (via role_permissions)
roles.tenant_id NULL = system-default, shared by every tenant

transactions *──1 accounts, *──1 funds, *──0..1 categories, *──1 financial_periods
transactions 0..1──1 transactions (reversed_by_transaction_id, self-reference)
transactions.reference_id → another transactions row (transfer leg pairing) OR a domain row (reference_type = 'contributions'/'expenses')

contributions *──0..1 contributors, *──1 accounts/funds/categories, 1──1 transactions (via transaction_id, posted at creation)
expenses *──1 categories/funds/accounts, 0..1──1 transactions (via transaction_id, posted only at 'paid')
```

---

## 5. Indexing (as implemented)

Matches the plan in the original design, now real:
- `(tenant_id, status)`, `(tenant_id, financial_period_id)`, `(tenant_id, account_id)`, `(tenant_id, fund_id)`, `(tenant_id, created_at)` on `transactions`.
- `UNIQUE(tenant_id, email)` on `users`, `UNIQUE(tenant_id, transaction_number)` on `transactions`, `UNIQUE(tenant_id, name)` on `accounts`/`funds`, `UNIQUE(tenant_id, type, name)` on `categories`.
- `UNIQUE(token_hash)` on `refresh_tokens` and `password_reset_tokens` — a hash collision would be a security event, not just a data error, so this is a hard constraint, not just a performance index.
- `(tenant_id, contribution_date)`, `(tenant_id, contributor_id)`, `(tenant_id, status)` on `contributions`; `UNIQUE(tenant_id, member_number)` on `contributors`.
- `(tenant_id, status)`, `(tenant_id, requested_by_user_id)` on `expenses`; `UNIQUE(tenant_id, expense_number)`, `UNIQUE(transaction_id)`.

---

## 6. Migration Strategy — Decision #16, RESOLVED

**Confirmed:** hand-written SQL + a custom runner, no ORM, no query builder. Implemented in `server/src/db/migrate.js`:
- Migrations are `NNNN_description.up.sql` / `NNNN_description.down.sql` pairs in `server/src/db/migrations/`.
- A `schema_migrations` table (created on first run) tracks applied migration names.
- `npm run migrate` applies every pending `.up.sql` in filename order, each inside its own transaction (one failed migration doesn't corrupt the ones before it, and doesn't half-apply).
- `npm run migrate:down` reverts the single most-recently-applied migration using its paired `.down.sql`; a migration with no `.down.sql` file is reported as non-reversible rather than silently doing nothing.
- Idempotent: running `up` again when nothing is pending is a documented no-op (tested in `tests/phase1/migrations.test.js`).

---

## 7. Financial Data Handling — The `direction` Column

The original Phase 0 design said "amount always positive; direction implied by type." Building the actual transfer logic in Phase 3 showed this doesn't hold: a transfer posts **two** rows that share `type = 'transfer'` but have opposite effects (one decreases the source account, one increases the destination). `type` alone can't disambiguate that, so an explicit `direction` (`in`/`out`) column was added to `transactions` beyond the original plan. Balance is computed as `SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END)` — see [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) §2 for the full reasoning. This is the one schema deviation from the Phase 0 design; every other table matches what was originally documented.

---

## 8. What Phase 7+ Must Deliver Against This Document

- The domain tables listed in §3 (`pledges`, `receipts`, `budgets`), each created in the phase that implements its business logic, following the same conventions (§1) and posting through the existing `financialEngine.service.js`, never inventing a parallel balance calculation.
- This document updated again once each domain table lands.

**Verification status (Phases 4–6):** migrations `0018`–`0020` are written and lint-clean but, like `0001`–`0017`, have not been executed against a live MySQL instance — see [MASTER_TODO.md](MASTER_TODO.md).

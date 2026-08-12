# Development Rules

Working conventions for building this product. These are binding for all phases, not suggestions.

---

## 1. Dependency Policy

- The current dependency list is deliberately minimal (React, React DOM, Vite tooling, ESLint — see [package.json](../package.json)). Additions require a real, present need — not "might be useful later."
- Before adding a library, check whether the platform (browser fetch, Node `crypto`, MySQL itself) already does the job.
- No ORM, no CSS framework, no state-management library unless a concrete problem in the actual codebase justifies it — see [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) §2 for what's explicitly excluded and why.
- Expected, justified additions as phases proceed: `react-router-dom` (Phase 10, routing), `axios` (Phase 2+, API calls), `express`, `mysql2`, `jsonwebtoken`, `bcrypt`/`argon2`, `express-validator` or `zod` (Phase 1–2, backend core), `pdfkit`/similar + `exceljs` (Phase 9, report generation), `cloudinary` SDK (Phase 7). Each should be added in the phase that first needs it, not pre-installed speculatively.
- Run `npm audit` before each phase's completion; do not ship a phase with a known-vulnerable dependency without a documented reason.

---

## 2. Backend Module Structure

Every domain module (`server/src/modules/<name>/`) follows the same shape:

```
<name>/
├── <name>.routes.js       # route definitions + middleware wiring only
├── <name>.controller.js   # request/response shaping only — no business logic
├── <name>.service.js      # business logic, calls repository + Financial Engine
├── <name>.repository.js   # all SQL for this module's tables lives here, tenant-scoped
└── <name>.validator.js    # request schema validation
```

Controllers do not contain SQL. Repositories do not contain business rules. Services do not build HTTP responses. This separation is what keeps the tenant-scoping and financial-integrity rules in [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) and [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md) enforceable — there's exactly one layer where "does this query have `tenant_id`" gets checked.

---

## 3. Environment & Secrets

- `.env` holds all secrets/config (DB credentials, JWT secret, Cloudinary keys); never committed. `.env.example` (committed) lists every required variable name with a placeholder/blank value, kept in sync whenever a new variable is introduced.
- No secret is ever hardcoded, logged, or included in an error response.
- Separate `.env` per environment (local, staging, production) — production secrets never copy-pasted into a local file that might get committed by accident.

---

## 4. Error Handling

- Follow the envelope defined in [API_ARCHITECTURE.md](API_ARCHITECTURE.md) §4 everywhere — no route hand-rolls its own error shape.
- Never swallow an error silently (empty `catch` blocks are not acceptable) — either handle it meaningfully or let it propagate to the centralized error handler.
- Validate at system boundaries (request input, external API responses); trust internal function contracts once validated — don't re-validate the same data three layers deep.

---

## 5. Localization (English / Swahili)

- All user-facing frontend strings go through an i18n dictionary/key lookup from the first screen built in Phase 10 — no hardcoded English strings that get "translated later." Retrofitting i18n across a finished UI is far more expensive than building it in from the start.
- Backend error `message` fields (§4) should be translatable where user-facing; `code` values are always English/stable and are what the frontend actually branches on.
- Currency/date formatting respects the tenant's locale setting ([DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) `tenants.locale_default`), not the browser's locale.

---

## 6. Testing Requirements

See also the Testing Strategy section of [MASTER_TODO.md](MASTER_TODO.md).

- Every Financial Engine function (posting, balance calculation, reversal) requires unit tests before the phase that introduces it is considered done — not deferred to a later hardening phase.
- Every new endpoint requires at minimum: one happy-path test, one auth-rejection test, one tenant-isolation test (per [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §1).
- No phase is marked complete in [MASTER_TODO.md](MASTER_TODO.md) with failing or skipped tests.

---

## 7. Git & Commit Practices

- Commit messages describe *why*, not just *what* — the diff already shows what changed.
- No direct commits of `.env`, credentials, or database dumps containing real church financial data.
- Feature work happens on branches; `master`/`main` reflects working state. (Branch-naming/PR-process specifics to be finalized once a second contributor joins — currently a solo-dev repo.)

---

## 8. Documentation Maintenance

- When an architectural decision changes (e.g. Decision #16 in [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) gets resolved, or a new one is made), update the relevant `docs/*.md` file in the same PR/commit as the code change — not as a follow-up "will document later" task.
- [MASTER_TODO.md](MASTER_TODO.md) checkboxes are updated as work actually completes, not batched at the end of a phase.

---

## 9. Definition of Done (per feature)

A feature is done when:
1. Backend: repository/service/controller/validator/routes exist, tenant-scoped, permission-gated.
2. Frontend: UI built mobile-first, wired to the real API (no mock data left in place).
3. Tests: per §6, passing.
4. Docs: any architectural doc affected is updated.
5. For anything touching money: it goes through the Financial Engine (no independent calculation) per [FINANCIAL_ARCHITECTURE.md](FINANCIAL_ARCHITECTURE.md).
6. [MASTER_TODO.md](MASTER_TODO.md) checkbox updated.

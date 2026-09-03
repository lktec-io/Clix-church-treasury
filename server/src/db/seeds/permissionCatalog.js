// The full permission catalog. Inert data until Phase 2 wires RBAC
// enforcement — seeded now so the schema is complete and stable from Phase 1.
// Source: Phase 2 brief's permission list, plus a few structurally implied
// additions noted inline.
export const PERMISSIONS = [
  ['dashboard.view', 'View the dashboard'],
  ['income.view', 'View income/contribution records'],
  ['income.create', 'Record income/contributions'],
  ['income.update', 'Edit a posted contribution\'s non-financial detail (notes, reference, contributor link) — never its amount/account/fund/category, which are immutable once posted; use income.reverse for financial corrections'],
  ['income.reverse', 'Reverse a posted income transaction'],
  ['contributors.view', 'View the contributor/donor directory (name, phone, email) — separate from income.view so financial amounts can be visible without exposing donor identity'],
  ['contributors.manage', 'Create/edit contributor records'],
  ['expense.view', 'View expense records'],
  ['expense.create', 'Create expense requests'],
  ['expense.update', 'Edit a draft expense before submission'],
  ['expense.submit', 'Submit an expense into the approval chain'],
  ['expense.approve', 'Approve a pending expense'],
  ['expense.reject', 'Reject a pending expense'],
  ['expense.pay', 'Mark an approved expense as paid (posts the ledger entry)'],
  ['accounts.view', 'View accounts (bank/cash/mobile money)'],
  ['accounts.manage', 'Create/edit accounts'],
  ['funds.view', 'View funds'],
  ['funds.manage', 'Create/edit funds'],
  ['categories.manage', 'Create/edit income and expense categories'],
  ['transfers.create', 'Create transfers between accounts/funds'],
  ['pledges.view', 'View pledges'],
  ['pledges.create', 'Create pledges'],
  ['receipts.view', 'View/download receipts'],
  ['reports.view', 'View reports'],
  ['reports.export', 'Export reports (PDF/Excel/CSV)'],
  ['budget.view', 'View budgets'],
  ['budget.manage', 'Create/edit budgets'],
  ['financial_period.view', 'View financial periods and their status'],
  ['financial_period.manage', 'Create financial periods'],
  ['financial_period.close', 'Close a financial period'],
  ['financial_period.reopen', 'Reopen a closed financial period (elevated, distinct from close)'],
  ['users.view', 'View tenant users'],
  ['users.manage', 'Invite/disable users, assign roles'],
  ['roles.manage', 'Manage custom roles and their permissions'],
  ['settings.manage', 'Manage church settings'],
  ['audit.view', 'View the audit log'],
  // Platform-level, not tenant-level — deliberately excluded from every
  // tenant-facing role's grant list (including Super Administrator's "ALL")
  // so a tenant admin can never reach this by accumulating tenant
  // permissions. Only the "Platform Administrator" system role below
  // grants it. Checked the same way every other permission is (RBAC
  // middleware.js's requirePermission), reusing the existing
  // authorization mechanism rather than a second one for this one case.
  ['platform.manage', 'Create/view/edit/activate/deactivate tenants across the whole platform (Platform Administrator only, never a tenant role)'],
];

// Permissions that must NEVER be included when a role's grant list is the
// literal string 'ALL' (seedRbacCatalog.js expands 'ALL' to
// "every permission in PERMISSIONS" — without this exclusion list, Super
// Administrator's 'ALL' would silently include platform.manage too,
// exactly the "tenant role becomes a platform role" leak this whole
// separation exists to prevent).
export const PLATFORM_ONLY_PERMISSIONS = ['platform.manage'];

// System roles that exist OUTSIDE the tenant world entirely.
//
// System roles are stored with tenant_id IS NULL so that every tenant can
// share one definition (Treasurer, Auditor, Viewer...). That sharing is
// exactly why this list is needed: "Platform Administrator" is also a
// tenant_id IS NULL row, so without an explicit exclusion it appears in
// every church's role picker AND passes assignRole's "is this role visible
// to my tenant?" check — letting any church admin with users.manage grant
// themselves platform.manage and take over every tenant on the platform.
//
// Two places consume this, and BOTH are required: roles.repository.js
// (never list it) and users.service.js (never assign it). Filtering the
// list alone is not a control — the API accepts a roleId directly.
export const PLATFORM_ONLY_ROLES = ['Platform Administrator'];

// System-default roles. tenant_id NULL — shared across every tenant.
// "ALL" grants every permission in the catalog above EXCEPT platform.manage
// (see its own comment) — Super Administrator is the top tenant-level role,
// not a platform-level one; the two are deliberately kept distinct.
export const SYSTEM_ROLES = {
  'Super Administrator': 'ALL',
  // The platform admin's own account is an ordinary tenant user (belongs
  // to some tenant like any other) holding this one role — this is what
  // lets it reuse the exact same login, JWT, refresh-token, and RBAC
  // machinery as every other user, with zero new auth code. It grants
  // ONLY platform.manage — no financial/tenant permissions — so a
  // platform admin does not automatically gain the ability to record
  // contributions, view another tenant's financial data through the
  // tenant-scoped API surface, etc. The reverse is also true: assigning
  // this role to someone does not grant it to any other tenant's users.
  'Platform Administrator': ['platform.manage'],
  'Treasurer': [
    'dashboard.view',
    'income.view', 'income.create', 'income.update', 'income.reverse',
    'contributors.view', 'contributors.manage',
    'expense.view', 'expense.create', 'expense.update', 'expense.submit', 'expense.pay',
    'accounts.view', 'accounts.manage',
    'funds.view', 'funds.manage',
    'categories.manage',
    'transfers.create',
    'pledges.view', 'pledges.create',
    'receipts.view',
    'reports.view', 'reports.export',
    'budget.view', 'budget.manage',
    'financial_period.view', 'financial_period.manage', 'financial_period.close',
  ],
  'Assistant Treasurer': [
    'dashboard.view',
    'income.view', 'income.create',
    'contributors.view',
    'expense.view', 'expense.create', 'expense.submit',
    'accounts.view',
    'funds.view',
    'pledges.view', 'pledges.create',
    'receipts.view',
    'reports.view',
    'budget.view',
    'financial_period.view',
  ],
  'Approver': [
    'dashboard.view',
    'expense.view', 'expense.approve', 'expense.reject',
    'reports.view',
  ],
  'Auditor': [
    'dashboard.view',
    'income.view', 'expense.view',
    'accounts.view', 'funds.view',
    'pledges.view', 'receipts.view',
    'reports.view', 'reports.export',
    'budget.view',
    'financial_period.view',
    'audit.view',
  ],
  'Viewer': [
    'dashboard.view',
    'income.view', 'expense.view',
    'accounts.view', 'funds.view',
    'pledges.view', 'receipts.view',
    'reports.view', 'budget.view',
    'financial_period.view',
  ],
};

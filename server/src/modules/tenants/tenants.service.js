import { withTransaction } from '../../config/db.js';
import { conflict, notFound } from '../../errors/AppError.js';
import { tenantsRepository } from './tenants.repository.js';
import { churchSettingsRepository } from './churchSettings.repository.js';
import { chartOfAccountsRepository } from '../financial/chartOfAccounts.repository.js';
import { departmentsRepository } from '../departments/departments.repository.js';
import { withSchemaFallback } from '../../db/schemaGuard.js';

export function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The low-level tenant lifecycle primitive, composable into a larger
// transaction (auth.service.js's registerTenant wraps this together with
// admin-user creation so the whole church sign-up is one atomic unit).
export async function createTenantWithConnection(connection, { name, slug, baseCurrency, localeDefault }) {
  const resolvedSlug = slug ? slugify(slug) : slugify(name);
  const existing = await tenantsRepository.findBySlug(resolvedSlug, connection);
  if (existing) {
    throw conflict(`Tenant slug "${resolvedSlug}" is already in use`);
  }
  const tenant = await tenantsRepository.create(
    { name, slug: resolvedSlug, baseCurrency, localeDefault },
    connection
  );
  await churchSettingsRepository.create(tenant.id, {}, connection);
  // Every church starts with the standard chart of accounts, so its very
  // first contribution posts a balanced journal entry rather than lazily
  // creating the accounts mid-transaction. journal.service.js still seeds
  // on demand as a backstop for tenants that predate the general ledger.
  //
  // Both seeds are wrapped in the schema fallback: registering a church is
  // the front door of the product, and it must not start failing because a
  // server is running code one migration ahead of its database. A tenant
  // created that way simply starts without the defaults — journal.service.js
  // seeds the chart of accounts lazily on first posting, and departments can
  // be added from the UI.
  await withSchemaFallback('chart_of_accounts.seed', () => chartOfAccountsRepository.seedTemplate(tenant.id, connection), null);
  await withSchemaFallback('departments.seed', () => departmentsRepository.seedDefaults(tenant.id, connection), null);
  return tenant;
}

export async function createTenant(data) {
  return withTransaction((connection) => createTenantWithConnection(connection, data));
}

export async function getTenantById(tenantId) {
  const tenant = await tenantsRepository.findById(tenantId);
  if (!tenant) throw notFound('Tenant not found');
  return tenant;
}

export async function setTenantStatus(tenantId, status) {
  const tenant = await tenantsRepository.updateStatus(tenantId, status);
  if (!tenant) throw notFound('Tenant not found');
  return tenant;
}

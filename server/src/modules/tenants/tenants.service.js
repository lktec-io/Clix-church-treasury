import { withTransaction } from '../../config/db.js';
import { conflict, notFound } from '../../errors/AppError.js';
import { tenantsRepository } from './tenants.repository.js';
import { churchSettingsRepository } from './churchSettings.repository.js';

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

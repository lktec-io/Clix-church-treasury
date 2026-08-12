import { notFound, conflict } from '../../errors/AppError.js';
import { categoriesRepository } from './categories.repository.js';

export async function listCategories(tenantId, { type } = {}) {
  const categories = await categoriesRepository.findAllByTenant(tenantId);
  return type ? categories.filter((c) => c.type === type) : categories;
}

export async function getCategory(tenantId, id) {
  const category = await categoriesRepository.findById(tenantId, id);
  if (!category) throw notFound('Category not found');
  return category;
}

export async function createCategory(tenantId, data) {
  const existing = await categoriesRepository.findByTypeAndName(tenantId, data.type, data.name);
  if (existing) {
    throw conflict(`A ${data.type} category named "${data.name}" already exists`);
  }
  return categoriesRepository.create(tenantId, data);
}

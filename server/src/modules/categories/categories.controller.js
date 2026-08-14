import * as categoriesService from './categories.service.js';
import { validateCreateCategory, validateUpdateCategory } from './categories.validator.js';

export async function list(req, res, next) {
  try {
    const categories = await categoriesService.listCategories(req.tenantId, { type: req.query.type });
    res.json({ success: true, data: categories });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const category = await categoriesService.getCategory(req.tenantId, req.params.id);
    res.json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const data = validateCreateCategory(req.body ?? {});
    const category = await categoriesService.createCategory(req.tenantId, data);
    res.status(201).json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const updates = validateUpdateCategory(req.body ?? {});
    const category = await categoriesService.updateCategory(req.tenantId, req.params.id, updates);
    res.json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
}

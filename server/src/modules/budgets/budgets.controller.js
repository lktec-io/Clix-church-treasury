import * as budgetsService from './budgets.service.js';
import { validateCreateBudget } from './budgets.validator.js';

function parseFilters(query) {
  const filters = {};
  if (query.financialPeriodId) filters.financialPeriodId = Number(query.financialPeriodId);
  if (query.fundId) filters.fundId = Number(query.fundId);
  if (query.status) filters.status = query.status;
  return filters;
}

export async function list(req, res, next) {
  try {
    const budgets = await budgetsService.listBudgetsWithActual(req.tenantId, parseFilters(req.query));
    res.json({ success: true, data: budgets });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const data = validateCreateBudget(req.body ?? {});
    const budget = await budgetsService.createBudget(req.tenantId, data, req.auth.userId);
    res.status(201).json({ success: true, data: budget });
  } catch (err) {
    next(err);
  }
}

export async function archive(req, res, next) {
  try {
    const budget = await budgetsService.archiveBudget(req.tenantId, req.params.id, req.auth.userId);
    res.json({ success: true, data: budget });
  } catch (err) {
    next(err);
  }
}

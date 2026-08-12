import { financialPeriodsRepository } from './financialPeriods.repository.js';
import { createPeriod, closePeriod, reopenPeriod } from './financialPeriods.service.js';
import { getFinancialSummary, getClosingChecklist } from './financialSummary.service.js';
import { validateCreatePeriod, validateReopenPeriod } from './financialPeriods.validator.js';
import { notFound } from '../../errors/AppError.js';

export async function list(req, res, next) {
  try {
    const periods = await financialPeriodsRepository.listForTenant(req.tenantId);
    res.json({ success: true, data: periods });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const period = await financialPeriodsRepository.findById(req.tenantId, req.params.id);
    if (!period) throw notFound('Financial period not found');
    res.json({ success: true, data: period });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const data = validateCreatePeriod(req.body ?? {});
    const period = await createPeriod(req.tenantId, data);
    res.status(201).json({ success: true, data: period });
  } catch (err) {
    next(err);
  }
}

export async function close(req, res, next) {
  try {
    const period = await closePeriod(req.tenantId, req.params.id, req.auth.userId);
    res.json({ success: true, data: period });
  } catch (err) {
    next(err);
  }
}

export async function reopen(req, res, next) {
  try {
    const reason = validateReopenPeriod(req.body ?? {});
    const period = await reopenPeriod(req.tenantId, req.params.id, req.auth.userId, reason);
    res.json({ success: true, data: period });
  } catch (err) {
    next(err);
  }
}

export async function summary(req, res, next) {
  try {
    const data = await getFinancialSummary(req.tenantId, req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function checklist(req, res, next) {
  try {
    const data = await getClosingChecklist(req.tenantId, req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

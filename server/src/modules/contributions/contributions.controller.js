import * as contributionsService from './contributions.service.js';
import {
  validateCreateContribution,
  validateUpdateContribution,
  validateReverseContribution,
} from './contributions.validator.js';

function parseFilters(query) {
  const filters = {};
  if (query.contributorId) filters.contributorId = Number(query.contributorId);
  if (query.pledgeId) filters.pledgeId = Number(query.pledgeId);
  if (query.fundId) filters.fundId = Number(query.fundId);
  if (query.paymentMethod) filters.paymentMethod = query.paymentMethod;
  if (query.dateFrom) filters.dateFrom = query.dateFrom;
  if (query.dateTo) filters.dateTo = query.dateTo;
  // Capped rather than trusting the client outright — a very large limit is
  // just an expensive, unbounded query in disguise.
  if (query.limit) filters.limit = Math.min(Number(query.limit), 200);
  if (query.offset) filters.offset = Number(query.offset);
  return filters;
}

export async function list(req, res, next) {
  try {
    const contributions = await contributionsService.listContributions(req.tenantId, parseFilters(req.query));
    const canViewContributors = req.permissions?.includes('contributors.view') ?? false;
    const data = await contributionsService.enrichWithContributorInfo(
      req.tenantId,
      contributions,
      canViewContributors
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const contribution = await contributionsService.getContribution(req.tenantId, req.params.id);
    const canViewContributors = req.permissions?.includes('contributors.view') ?? false;
    const [enriched] = await contributionsService.enrichWithContributorInfo(
      req.tenantId,
      [contribution],
      canViewContributors
    );
    res.json({ success: true, data: enriched });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const data = validateCreateContribution(req.body ?? {});
    const contribution = await contributionsService.recordContribution(req.tenantId, data, req.auth.userId);
    res.status(201).json({ success: true, data: contribution });
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const updates = validateUpdateContribution(req.body ?? {});
    const contribution = await contributionsService.updateContribution(
      req.tenantId,
      req.params.id,
      updates,
      req.auth.userId
    );
    res.json({ success: true, data: contribution });
  } catch (err) {
    next(err);
  }
}

export async function reverse(req, res, next) {
  try {
    const { reason } = validateReverseContribution(req.body ?? {});
    const contribution = await contributionsService.reverseContribution(
      req.tenantId,
      req.params.id,
      reason,
      req.auth.userId
    );
    res.json({ success: true, data: contribution });
  } catch (err) {
    next(err);
  }
}

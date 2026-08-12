import * as pledgesService from './pledges.service.js';
import { validateCreatePledge, validateUpdatePledge, validateSetPledgeStatus } from './pledges.validator.js';
import { enrichWithContributorInfo } from '../contributors/contributorEnrichment.js';

function parseFilters(query) {
  const filters = {};
  if (query.contributorId) filters.contributorId = Number(query.contributorId);
  if (query.fundId) filters.fundId = Number(query.fundId);
  if (query.status) filters.status = query.status;
  return filters;
}

export async function list(req, res, next) {
  try {
    const pledges = await pledgesService.listPledges(req.tenantId, parseFilters(req.query));
    const canViewContributors = req.permissions?.includes('contributors.view') ?? false;
    const data = await enrichWithContributorInfo(req.tenantId, pledges, canViewContributors);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const pledge = await pledgesService.getPledge(req.tenantId, req.params.id);
    const canViewContributors = req.permissions?.includes('contributors.view') ?? false;
    const [enriched] = await enrichWithContributorInfo(req.tenantId, [pledge], canViewContributors);
    res.json({ success: true, data: enriched });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const data = validateCreatePledge(req.body ?? {});
    const pledge = await pledgesService.createPledge(req.tenantId, data, req.auth.userId);
    res.status(201).json({ success: true, data: pledge });
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const updates = validateUpdatePledge(req.body ?? {});
    const pledge = await pledgesService.updatePledge(req.tenantId, req.params.id, updates, req.auth.userId);
    res.json({ success: true, data: pledge });
  } catch (err) {
    next(err);
  }
}

export async function setStatus(req, res, next) {
  try {
    const status = validateSetPledgeStatus(req.body ?? {});
    const pledge = await pledgesService.setPledgeStatus(req.tenantId, req.params.id, status, req.auth.userId);
    res.json({ success: true, data: pledge });
  } catch (err) {
    next(err);
  }
}

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

// POST /contributions
//
// 201 means exactly one thing: the gift, its ledger entries (and Makato fee
// line) and its receipt are committed. The response is decided the moment
// that transaction commits — nothing that happens afterwards can change it.
//
//   data.sms_status   'queued'  confirmation SMS handed to a background job
//                     'skipped' no contributor to notify, or a deduplicated
//                               retry (the original request already did)
//
// The SMS outcome itself is never part of this response: it happens after
// the response is sent (contributions.service.js#scheduleConfirmationSms),
// is logged server-side, and can be retried from the resend-sms endpoint.
//
// A retry carrying the same idempotencyKey returns the ORIGINAL record with
// `deduplicated: true` and posts nothing — the key is checked before any
// financial work and backstopped by a UNIQUE index (migration 0032).
//
// Failures that do reach next(): a validation error (422), no open period
// (404), a closed/foreign account/fund (422), and — if the database is behind
// this build's migrations — a 503 SCHEMA_OUT_OF_DATE (middleware/
// errorHandler.js). In every one of those the transaction rolled back whole,
// so nothing was recorded and a retry is safe.
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

export async function resendSms(req, res, next) {
  try {
    const sms = await contributionsService.resendContributionSms(req.tenantId, req.params.id);
    res.json({ success: true, data: { sms } });
  } catch (err) {
    next(err);
  }
}

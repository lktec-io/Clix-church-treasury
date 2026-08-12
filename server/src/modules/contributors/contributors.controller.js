import * as contributorsService from './contributors.service.js';
import { validateCreateContributor } from './contributors.validator.js';

export async function list(req, res, next) {
  try {
    const contributors = await contributorsService.listContributors(req.tenantId);
    res.json({ success: true, data: contributors });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const contributor = await contributorsService.getContributor(req.tenantId, req.params.id);
    res.json({ success: true, data: contributor });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const data = validateCreateContributor(req.body ?? {});
    const contributor = await contributorsService.createContributor(req.tenantId, data);
    res.status(201).json({ success: true, data: contributor });
  } catch (err) {
    next(err);
  }
}

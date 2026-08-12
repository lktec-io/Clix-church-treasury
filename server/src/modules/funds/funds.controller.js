import * as fundsService from './funds.service.js';
import { validateCreateFund } from './funds.validator.js';

export async function list(req, res, next) {
  try {
    const funds = await fundsService.listFunds(req.tenantId);
    res.json({ success: true, data: funds });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const fund = await fundsService.getFund(req.tenantId, req.params.id);
    res.json({ success: true, data: fund });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const data = validateCreateFund(req.body ?? {});
    const fund = await fundsService.createFund(req.tenantId, data);
    res.status(201).json({ success: true, data: fund });
  } catch (err) {
    next(err);
  }
}

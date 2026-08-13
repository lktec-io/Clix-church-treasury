import * as fundsService from './funds.service.js';
import { validateCreateFund, validateRenameFund } from './funds.validator.js';

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
    const fund = await fundsService.createFund(req.tenantId, data, req.auth.userId);
    res.status(201).json({ success: true, data: fund });
  } catch (err) {
    next(err);
  }
}

export async function rename(req, res, next) {
  try {
    const name = validateRenameFund(req.body ?? {});
    const fund = await fundsService.renameFund(req.tenantId, req.params.id, name, req.auth.userId);
    res.json({ success: true, data: fund });
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req, res, next) {
  try {
    const fund = await fundsService.setFundActive(req.tenantId, req.params.id, false, req.auth.userId);
    res.json({ success: true, data: fund });
  } catch (err) {
    next(err);
  }
}

export async function activate(req, res, next) {
  try {
    const fund = await fundsService.setFundActive(req.tenantId, req.params.id, true, req.auth.userId);
    res.json({ success: true, data: fund });
  } catch (err) {
    next(err);
  }
}

import * as remittanceService from './remittance.service.js';
import { validateCreateRule, validateRemitPayment } from './remittance.validator.js';

export async function overview(req, res, next) {
  try {
    const financialPeriodId = req.query.financialPeriodId ? Number(req.query.financialPeriodId) : undefined;
    const data = await remittanceService.getRemittanceOverview(req.tenantId, { financialPeriodId });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function listRules(req, res, next) {
  try {
    res.json({ success: true, data: await remittanceService.listRules(req.tenantId) });
  } catch (err) {
    next(err);
  }
}

export async function createRule(req, res, next) {
  try {
    const data = validateCreateRule(req.body ?? {});
    const rule = await remittanceService.createRule(req.tenantId, data, req.auth.userId);
    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    next(err);
  }
}

export async function remit(req, res, next) {
  try {
    const data = validateRemitPayment(req.body ?? {});
    const result = await remittanceService.remitToHigherBody(req.tenantId, req.params.id, data, req.auth.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

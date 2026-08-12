import * as transfersService from './transfers.service.js';
import { validateCreateTransfer } from './transfers.validator.js';

export async function list(req, res, next) {
  try {
    const transfers = await transfersService.listTransfers(req.tenantId, {});
    res.json({ success: true, data: transfers });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const transfer = await transfersService.getTransfer(req.tenantId, req.params.id);
    res.json({ success: true, data: transfer });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const data = validateCreateTransfer(req.body ?? {});
    const transfer = await transfersService.createTransfer(req.tenantId, data, req.auth.userId);
    res.status(201).json({ success: true, data: transfer });
  } catch (err) {
    next(err);
  }
}

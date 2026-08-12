import * as accountsService from './accounts.service.js';
import { validateCreateAccount } from './accounts.validator.js';

export async function list(req, res, next) {
  try {
    const accounts = await accountsService.listAccounts(req.tenantId);
    res.json({ success: true, data: accounts });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const account = await accountsService.getAccount(req.tenantId, req.params.id);
    res.json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const data = validateCreateAccount(req.body ?? {});
    const account = await accountsService.createAccount(req.tenantId, data);
    res.status(201).json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
}

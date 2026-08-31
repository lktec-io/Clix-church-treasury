import * as platformService from './platform.service.js';
import { validateCreateTenant, validateUpdateTenant, validateTenantStatus } from './platform.validator.js';

export async function listTenants(req, res, next) {
  try {
    const tenants = await platformService.listTenants();
    res.json({ success: true, data: tenants });
  } catch (err) {
    next(err);
  }
}

export async function getTenant(req, res, next) {
  try {
    const tenant = await platformService.getTenantDetail(Number(req.params.id));
    res.json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
}

export async function createTenant(req, res, next) {
  try {
    const data = validateCreateTenant(req.body ?? {});
    const result = await platformService.createTenant(data, req.auth.userId);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function updateTenant(req, res, next) {
  try {
    const data = validateUpdateTenant(req.body ?? {});
    const tenant = await platformService.updateTenant(Number(req.params.id), data, req.auth.userId);
    res.json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
}

export async function setTenantStatus(req, res, next) {
  try {
    const { status } = validateTenantStatus(req.body ?? {});
    const tenant = await platformService.setTenantStatus(Number(req.params.id), status, req.auth.userId);
    res.json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
}

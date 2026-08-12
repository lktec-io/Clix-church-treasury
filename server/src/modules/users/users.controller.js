import * as usersService from './users.service.js';
import { validateInviteUser, validateAssignRole } from './users.validator.js';

export async function list(req, res, next) {
  try {
    const users = await usersService.listUsers(req.tenantId);
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}

export async function invite(req, res, next) {
  try {
    const data = validateInviteUser(req.body ?? {});
    const result = await usersService.inviteUser(req.tenantId, data, req.auth.userId);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function assignRole(req, res, next) {
  try {
    const { roleId } = validateAssignRole(req.body ?? {});
    const result = await usersService.assignRole(req.tenantId, req.params.id, roleId, req.auth.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function removeRole(req, res, next) {
  try {
    const roleId = Number(req.params.roleId);
    const result = await usersService.removeRole(req.tenantId, req.params.id, roleId, req.auth.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function disable(req, res, next) {
  try {
    const user = await usersService.disableUser(req.tenantId, req.params.id, req.auth.userId);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

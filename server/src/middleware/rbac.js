import { forbidden } from '../errors/AppError.js';
import { permissionsRepository } from '../modules/permissions/permissions.repository.js';

// Authorization is always re-derived from the database on every request —
// never trusted from the JWT — so a permission change (or role removal)
// takes effect on the very next request, not only after the access token
// expires (docs/SECURITY_ARCHITECTURE.md §3).
export function requirePermission(permissionName) {
  return async (req, res, next) => {
    try {
      const permissions = await permissionsRepository.listForUser(req.auth.userId);
      if (!permissions.includes(permissionName)) {
        return next(forbidden(`Missing permission: ${permissionName}`));
      }
      req.permissions = permissions;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// APPROVAL AUTHORITY.
//
// Who may approve, reject or release payment on an expense, stated as roles
// because that is how the church states it: an Admin or a Senior Treasurer,
// nobody else. "Admin" in this product is the Super Administrator role —
// there is no role literally named Admin, and inventing a second one would
// give every church two top-level roles to keep in step.
//
// This is deliberately a SECOND gate, not a replacement for the permission
// check on these routes. The permission answers "is this capability granted
// to you at all", which is still the mechanism everything else uses; this
// answers the narrower policy question the church asked for, at one
// chokepoint, where it can be read and changed in one place.
export const APPROVAL_ROLES = ['Super Administrator', 'Senior Treasurer'];

export function requireApprovalRole(action) {
  return async (req, res, next) => {
    try {
      const roles = await permissionsRepository.listRoleNamesForUser(req.auth.userId);
      if (roles.some((role) => APPROVAL_ROLES.includes(role))) {
        req.roles = roles;
        return next();
      }
      // Says exactly what is missing and what would fix it. "Not permitted"
      // on its own sends a treasurer to the wrong person for help.
      return next(
        forbidden(
          `Only ${APPROVAL_ROLES.join(' or ')} may ${action}. ` +
            `Your ${roles.length === 1 ? 'role is' : 'roles are'} ${roles.length > 0 ? roles.join(', ') : 'none'}. ` +
            'Ask an administrator to assign you one of those roles.'
        )
      );
    } catch (err) {
      next(err);
    }
  };
}

// The platform-level authorization boundary for every /api/v1/platform/*
// route. Deliberately just requirePermission('platform.manage') — not a
// second authorization system — so a platform admin is authenticated,
// authorized, and re-checked on every request through the exact same
// database-backed RBAC path as any other permission (never trusted from
// the JWT alone; see requirePermission's own comment). A tenant's Super
// Administrator does not hold this permission (permissionCatalog.js
// explicitly excludes it from "ALL") and therefore gets 403 here even
// though they're a fully authenticated, fully-permissioned user within
// their own tenant — tenant role and platform role are enforced as
// genuinely separate things, not merely styled as separate in the UI.
export function requirePlatformAdmin(req, res, next) {
  return requirePermission('platform.manage')(req, res, next);
}

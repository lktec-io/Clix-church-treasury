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

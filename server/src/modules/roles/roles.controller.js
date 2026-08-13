import { rolesRepository } from './roles.repository.js';

// Read-only — supports the Users admin screen's "assign a role" picker.
// Custom tenant-role creation isn't built (system roles only, per
// docs/SECURITY_ARCHITECTURE.md §3), so this never needs a POST.
export async function list(req, res, next) {
  try {
    const roles = await rolesRepository.listForTenant(req.tenantId);
    res.json({ success: true, data: roles });
  } catch (err) {
    next(err);
  }
}

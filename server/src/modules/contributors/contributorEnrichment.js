import { contributorsRepository } from './contributors.repository.js';

// Shared privacy boundary: contributor identity is only attached for
// callers who hold contributors.view — everyone else sees the financial
// record with contributor_id present but no resolved name/phone/email
// (docs/SECURITY_ARCHITECTURE.md §1). Used by both contributions and
// pledges, since both reference a contributor the same way.
export async function enrichWithContributorInfo(tenantId, rows, canViewContributors) {
  if (!canViewContributors) return rows;
  const contributorIds = [...new Set(rows.map((r) => r.contributor_id).filter(Boolean))];
  if (contributorIds.length === 0) return rows;

  const contributors = await Promise.all(contributorIds.map((id) => contributorsRepository.findById(tenantId, id)));
  const byId = new Map(contributors.filter(Boolean).map((c) => [c.id, c]));

  return rows.map((r) => ({
    ...r,
    contributor: r.contributor_id ? byId.get(r.contributor_id) ?? null : null,
  }));
}

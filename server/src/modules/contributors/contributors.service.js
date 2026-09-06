import { notFound, conflict, validationError } from '../../errors/AppError.js';
import { withTransaction } from '../../config/db.js';
import { contributorsRepository } from './contributors.repository.js';
import { normalizeTzPhone } from '../sms/phoneNumber.js';
import { recordAuditLog } from '../audit/auditLog.service.js';
import { parseContributorImport } from './bulkImport.js';

export async function listContributors(tenantId) {
  return contributorsRepository.findAllByTenant(tenantId);
}

export async function getContributor(tenantId, id) {
  const contributor = await contributorsRepository.findById(tenantId, id);
  if (!contributor) throw notFound('Contributor not found');
  return contributor;
}

export async function createContributor(tenantId, data) {
  if (data.memberNumber) {
    const existing = await contributorsRepository.findByMemberNumber(tenantId, data.memberNumber);
    if (existing) {
      throw conflict(`Member number "${data.memberNumber}" is already in use`);
    }
  }
  try {
    return await contributorsRepository.create(tenantId, data);
  } catch (error) {
    // Backstop for the narrow race window above — the DB's own unique
    // constraint is the real guarantee; this only makes a genuine
    // concurrent collision return a friendly 409 instead of a raw 500.
    if (error.code === 'ER_DUP_ENTRY' && error.message.includes('uq_contributors_tenant_member_number')) {
      throw conflict(`Member number "${data.memberNumber}" is already in use`);
    }
    throw error;
  }
}

// Dedupe keys. Phone is compared in NORMALIZED form (normalizeTzPhone), so
// "0712345678", "+255 712 345 678" and "255712345678" are recognised as the
// same person — which is the whole point, since a spreadsheet exported from
// one system and a directory typed into another will not agree on format.
// Email is compared case-insensitively for the same reason.
//
// A row with neither a phone nor an email has no identity to match on, so it
// is always treated as new. That is the correct call for a church directory:
// two members can genuinely share a name, and silently merging them would
// lose one of them.
function dedupeKeys({ phone, email }) {
  const keys = [];
  const normalizedPhone = normalizeTzPhone(phone);
  if (normalizedPhone) keys.push(`phone:${normalizedPhone}`);
  else if (phone) keys.push(`phone-raw:${phone.replace(/\s/g, '')}`);
  if (email) keys.push(`email:${email.toLowerCase()}`);
  return keys;
}

/**
 * Bulk-creates contributors from an uploaded CSV/XLSX file.
 *
 * The whole import is ONE transaction: either every accepted row lands or
 * none does. A partially-applied member import is the worst outcome here —
 * a clerk cannot tell which half succeeded, and re-running the file would
 * duplicate whatever did. Rows that are skipped (invalid, or a duplicate)
 * are reported back rather than silently dropped, so the clerk sees exactly
 * what happened to every line of their spreadsheet.
 */
export async function bulkImportContributors(tenantId, contentBase64, actorUserId) {
  const rows = await parseContributorImport(contentBase64);
  if (rows.length === 0) {
    throw validationError('Invalid payload', { file: 'contains no data rows below the header' });
  }

  return withTransaction(async (connection) => {
    // Existing directory, read inside the transaction so a concurrent import
    // of the same file cannot both pass their duplicate checks.
    const existing = await contributorsRepository.findAllByTenant(tenantId, connection);
    const seen = new Set();
    for (const contributor of existing) {
      for (const key of dedupeKeys(contributor)) seen.add(key);
    }

    const imported = [];
    const skipped = [];

    for (const row of rows) {
      if (!row.fullName) {
        skipped.push({ rowNumber: row.rowNumber, name: null, reason: 'missing_name' });
        continue;
      }
      if (row.fullName.length > 255 || row.phone.length > 50 || row.email.length > 255) {
        skipped.push({ rowNumber: row.rowNumber, name: row.fullName, reason: 'field_too_long' });
        continue;
      }

      const keys = dedupeKeys(row);
      // `seen` accumulates as we go, so a file containing the same member
      // twice imports them once — in-batch duplicates are caught by the same
      // mechanism as against-database ones.
      if (keys.some((key) => seen.has(key))) {
        skipped.push({ rowNumber: row.rowNumber, name: row.fullName, reason: 'duplicate' });
        continue;
      }
      for (const key of keys) seen.add(key);

      const created = await contributorsRepository.create(
        tenantId,
        {
          fullName: row.fullName,
          phone: row.phone || null,
          email: row.email || null,
          gender: row.gender,
          memberNumber: null,
        },
        connection
      );
      imported.push(created);
    }

    await recordAuditLog(
      {
        tenantId,
        actorUserId,
        action: 'contributor.bulk_imported',
        entityType: 'contributors',
        // No single entity id — this describes the batch, so the counts and
        // the skip reasons ARE the record.
        entityId: null,
        after: { imported: imported.length, skipped: skipped.length, totalRows: rows.length },
      },
      connection
    );

    return { imported: imported.length, skipped, totalRows: rows.length, contributors: imported };
  });
}

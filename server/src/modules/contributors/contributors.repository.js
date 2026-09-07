import { pool } from '../../config/db.js';
import { TenantScopedRepository } from '../../db/TenantScopedRepository.js';

// Whether contributors.gender (migration 0035) exists on THIS server.
//
// Deploying code ahead of running migrations is a normal ordering on a live
// box, and it used to be fatal here: the bulk import writes `gender`, so an
// un-migrated server answered every upload with
// `ER_BAD_FIELD_ERROR: Unknown column 'gender' in 'field list'` — a 500 with
// no hint that a migration was the cause.
//
// Caching rule is deliberately asymmetric:
//   · true  is cached forever — a column cannot disappear under a running
//     process, so the probe never needs to run again.
//   · false is NOT cached — otherwise running `npm run migrate` against a
//     live server would leave every worker permanently convinced the column
//     is still missing until someone restarted them. Re-probing costs one
//     indexed INFORMATION_SCHEMA lookup on an operation (a bulk import or a
//     single contributor create) that is rare and already doing real work.
let genderColumnPresent = false;
let missingColumnWarned = false;

async function hasGenderColumn(runner) {
  if (genderColumnPresent) return true;
  try {
    const [rows] = await runner.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contributors' AND COLUMN_NAME = 'gender'
        LIMIT 1`
    );
    genderColumnPresent = rows.length > 0;
  } catch {
    // If the probe itself fails, assume absent and write without the column.
    // Losing an optional field beats failing the whole import.
    genderColumnPresent = false;
  }

  if (!genderColumnPresent && !missingColumnWarned) {
    missingColumnWarned = true;
    console.warn(
      '[contributors] contributors.gender is missing — migration 0035 has not been applied to this database. ' +
        'Contributors are being saved WITHOUT gender. Run "npm run migrate" (server/) to enable it; ' +
        'no restart is needed afterwards.'
    );
  }
  return genderColumnPresent;
}

class ContributorsRepository extends TenantScopedRepository {
  constructor() {
    super('contributors');
  }

  async findByMemberNumber(tenantId, memberNumber, connection) {
    if (!memberNumber) return null;
    const [rows] = await this.runner(connection).query(
      'SELECT * FROM contributors WHERE tenant_id = ? AND member_number = ? LIMIT 1',
      [tenantId, memberNumber]
    );
    return rows[0] ?? null;
  }

  // The same deliberate exception users.repository.js#findByIdAnyTenant
  // documents: the member-portal refresh-token flow only has a
  // contributor_id (from the token record) to start from and must discover
  // that contributor's tenant itself — the tenant_id it returns comes from
  // the server-side row, never client input, so this does not weaken
  // tenant isolation (SECURITY_ARCHITECTURE.md §1).
  async findByIdAnyTenant(id, connection) {
    const [rows] = await this.runner(connection ?? pool).query(
      'SELECT * FROM contributors WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] ?? null;
  }

  async create(tenantId, { fullName, phone, email, gender, memberNumber }, connection) {
    const row = {
      full_name: fullName,
      phone: phone ?? null,
      email: email ?? null,
      member_number: memberNumber ?? null,
      is_active: true,
    };

    // The column name is the lowercase `gender` the migration declares, and
    // the value is one of its ENUM members — 'male' | 'female' |
    // 'unspecified' — or null. bulkImport.js#normalizeGender is what maps
    // whatever a clerk typed ("M", "Ke", "Mwanamke") onto exactly those
    // lowercase strings, so nothing case-variant or free-text ever reaches
    // the ENUM. NULL means "never recorded", which is the column's default.
    //
    // Omitted entirely (rather than sent as NULL) when the column does not
    // exist yet, so an un-migrated server still imports members instead of
    // rejecting the whole file.
    if (await hasGenderColumn(this.runner(connection))) {
      row.gender = gender ?? null;
    }

    return this.insert(tenantId, row, connection);
  }
}

export const contributorsRepository = new ContributorsRepository();

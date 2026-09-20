import { defineConfig } from 'vitest/config';

// THE DATABASE-FREE TEST LANE — `npm run test:unit`.
//
// The main suite (vitest.config.js) provisions a MySQL test database in
// globalSetup, so ON A MACHINE WITHOUT MYSQL NOT A SINGLE TEST RUNS, including
// the many that never touch it: money arithmetic, phone-number normalisation,
// SMS templates, permission catalogues, the report row cap. Those are exactly
// the tests worth having while writing code, and losing all of them to an
// unrelated missing service means they get run late or not at all.
//
// This config runs that subset with no globalSetup and no setupFiles. It does
// not replace `npm test` — the integration suites still own everything that
// involves real SQL, and CI must run both.
//
// The file list is explicit, not a glob, so the lane cannot silently start
// depending on a database. ADDING A TEST FILE HERE: run it under this config;
// if it passes with MySQL stopped, it belongs in the list.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 15000,
    env: { NODE_ENV: 'test' },
    include: [
      'tests/phase14/beemProvider.test.js',
      'tests/phase14/beemSenderIdWarning.test.js',
      'tests/phase14/envSmsConfig.test.js',
      'tests/phase14/phoneNumber.test.js',
      'tests/phase15/platformAuthorization.test.js',
      'tests/phase15/platformPermissionCatalog.test.js',
      'tests/phase15/platformTenantProtection.test.js',
      'tests/phase15/platformValidator.test.js',
      'tests/phase15/tenantSuspensionEnforcement.test.js',
      'tests/phase16/monthlyTrends.test.js',
      'tests/phase16/smsSwahiliTemplates.test.js',
      'tests/phase17/bulkImport.test.js',
      'tests/phase17/senderId.test.js',
      'tests/phase18/remittance.test.js',
      'tests/phase19/treasuryFeatures.test.js',
    ],
  },
});

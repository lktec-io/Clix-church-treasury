import { pool } from '../../src/config/db.js';

// Reverse of FK dependency order — see docs/DATABASE_ARCHITECTURE.md §3.
const TABLES_IN_DELETE_ORDER = [
  'audit_logs',
  'receipts',
  'receipt_sequences',
  'budgets',
  'contributions',
  'pledges',
  'contributors',
  'expenses',
  'transactions',
  'financial_periods',
  'categories',
  'funds',
  'accounts',
  'password_reset_tokens',
  'refresh_tokens',
  'user_roles',
  'role_permissions',
  'roles',
  'permissions',
  'users',
  'church_settings',
  'tenants',
  'system_settings',
];

export async function resetDatabase() {
  const connection = await pool.getConnection();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES_IN_DELETE_ORDER) {
      await connection.query(`TRUNCATE TABLE ${table}`);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    connection.release();
  }
}

// DATABASE_ARCHITECTURE.md: timestamps are app-set, not DB-defaulted, so the
// application controls audit-relevant timing consistently. This is the one
// place that formats "now" for storage — every repository insert/update uses it.
export function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

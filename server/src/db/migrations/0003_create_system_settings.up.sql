-- Platform-wide (not tenant-scoped) key/value configuration, e.g. maintenance mode,
-- feature flags. Distinct from church_settings, which is per-tenant.
CREATE TABLE system_settings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(150) NOT NULL,
  setting_value TEXT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_system_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

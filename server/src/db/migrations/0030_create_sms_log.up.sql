-- Durable record of every SMS attempt (member registration, contribution
-- confirmation, monthly statement) regardless of outcome — backs the
-- "Contribution saved successfully. SMS: Sent / Pending / Failed" UI
-- requirement, and is the only place a rendered message body is ever
-- persisted (the sms module never reuses this table to resend). This
-- table is written to strictly after the triggering DB transaction has
-- already committed (server/src/modules/sms/sms.service.js) — a failed or
-- slow SMS can never roll back or block a financial record.
CREATE TABLE sms_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  contributor_id BIGINT UNSIGNED NULL,
  phone VARCHAR(50) NOT NULL,
  template_key VARCHAR(50) NOT NULL,
  locale VARCHAR(5) NOT NULL,
  body TEXT NOT NULL,
  status ENUM('sent', 'failed', 'skipped_no_provider') NOT NULL,
  provider_message_id VARCHAR(255) NULL,
  error_message VARCHAR(500) NULL,
  related_type VARCHAR(50) NULL,
  related_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_sms_log_tenant (tenant_id),
  KEY idx_sms_log_contributor (contributor_id),
  CONSTRAINT fk_sms_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sms_log_contributor FOREIGN KEY (contributor_id) REFERENCES contributors (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

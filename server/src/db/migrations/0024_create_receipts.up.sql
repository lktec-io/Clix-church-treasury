-- One receipt per contribution (income, including pledge payments — a
-- pledge payment is just a contribution, see docs/FINANCIAL_ARCHITECTURE.md
-- §7). One receipt architecture for every income source, per docs/MASTER_TODO.md
-- Phase 7 — no per-module receipt logic.
CREATE TABLE receipts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  contribution_id BIGINT UNSIGNED NOT NULL,
  receipt_number VARCHAR(50) NOT NULL,
  issued_by_user_id BIGINT UNSIGNED NOT NULL,
  issued_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_receipts_contribution (contribution_id),
  UNIQUE KEY uq_receipts_tenant_number (tenant_id, receipt_number),
  CONSTRAINT fk_receipts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_receipts_contribution FOREIGN KEY (contribution_id) REFERENCES contributions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_receipts_issued_by FOREIGN KEY (issued_by_user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

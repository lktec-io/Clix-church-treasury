-- HIGHER-BODY REMITTANCE ENGINE
--
-- Tanzanian church structures (SDA Conference, KKKT Diocese, and the
-- equivalents) require a fixed share of specific local inflows to be passed
-- upward on a recurring schedule — canonically 100% of Zaka/Tithe. Until now
-- a treasurer tracked that obligation outside the system, which is exactly
-- where it gets lost.
--
-- MODELLED AS AN ACCRUING LIABILITY, not as a report run at closing. The
-- moment a contribution lands in a fund carrying a rule, the share due is
-- accrued against the open period. That means "what do we currently owe the
-- Conference" is answerable at any instant, and a period cannot quietly
-- close with an unrecorded obligation.

-- One rule per fund per tenant: "of everything that lands in Zaka, 100% is
-- remitted upward".
CREATE TABLE remittance_rules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  fund_id BIGINT UNSIGNED NOT NULL,
  -- Display name of the receiving body ("Northern Tanzania Conference").
  -- Per-tenant free text: the hierarchy above a congregation differs by
  -- denomination and this system must not hardcode one.
  higher_body_name VARCHAR(150) NOT NULL,
  -- DECIMAL(5,2) spans 0.00–100.00 exactly. NEVER a float: a remittance
  -- percentage multiplies real money and binary floating point cannot
  -- represent 33.33 (docs/FINANCIAL_ARCHITECTURE.md — money is never a
  -- JS number).
  percentage_to_remit DECIMAL(5, 2) NOT NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  -- One rule per fund. A fund with two competing percentages has no
  -- defensible answer for how much is owed, so the DB refuses the state
  -- rather than leaving the service to pick.
  UNIQUE KEY uq_remittance_rules_tenant_fund (tenant_id, fund_id),
  KEY idx_remittance_rules_tenant_status (tenant_id, status),
  CONSTRAINT fk_remittance_rules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_remittance_rules_fund FOREIGN KEY (fund_id) REFERENCES funds (id) ON DELETE RESTRICT,
  CONSTRAINT chk_remittance_rules_percentage CHECK (percentage_to_remit >= 0 AND percentage_to_remit <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The running obligation: one bucket per rule per financial period.
-- `amount_accrued` climbs as contributions arrive; `amount_paid` climbs as
-- the treasurer remits. The difference is the outstanding liability.
--
-- Each actual payout posts a normal expense transaction carrying
-- reference_type='remittance_ledgers' / reference_id=<this row>, so the
-- money movement lives in the one ledger every other movement lives in —
-- there is no second, parallel set of books.
CREATE TABLE remittance_ledgers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  financial_period_id BIGINT UNSIGNED NOT NULL,
  rule_id BIGINT UNSIGNED NOT NULL,
  -- Denormalised from the rule so a report can group by fund without a
  -- join, and so the bucket still reads correctly if the rule is later
  -- retargeted. The rule remains the source of truth for the percentage.
  fund_id BIGINT UNSIGNED NOT NULL,
  amount_accrued DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  amount_paid DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  status_flag ENUM('pending_transfer', 'partially_remitted', 'fully_remitted') NOT NULL DEFAULT 'pending_transfer',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  -- The accrual hook depends on this: it upserts one bucket per
  -- (period, rule) and increments it, so a race between two simultaneous
  -- contributions cannot create two buckets for the same obligation.
  UNIQUE KEY uq_remittance_ledgers_period_rule (tenant_id, financial_period_id, rule_id),
  KEY idx_remittance_ledgers_tenant_status (tenant_id, status_flag),
  CONSTRAINT fk_remittance_ledgers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_remittance_ledgers_period FOREIGN KEY (financial_period_id) REFERENCES financial_periods (id) ON DELETE RESTRICT,
  CONSTRAINT fk_remittance_ledgers_rule FOREIGN KEY (rule_id) REFERENCES remittance_rules (id) ON DELETE RESTRICT,
  CONSTRAINT fk_remittance_ledgers_fund FOREIGN KEY (fund_id) REFERENCES funds (id) ON DELETE RESTRICT,
  CONSTRAINT chk_remittance_ledgers_amounts CHECK (amount_accrued >= 0 AND amount_paid >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

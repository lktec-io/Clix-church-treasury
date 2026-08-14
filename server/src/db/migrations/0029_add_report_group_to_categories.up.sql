-- Lets a treasurer mark exactly which category represents Zaka/Tithe and
-- which represents Sadaka/Offering, independent of how they happen to have
-- named it — the monthly member statement (Zaka/Sadaka/Matoleo Mengine)
-- buckets by this column, not by category name string-matching, so it
-- stays correct regardless of language or per-tenant naming choices.
-- NULL (the default, including every existing category) means "other" —
-- non-breaking for every tenant that never sets it.
ALTER TABLE categories
  ADD COLUMN report_group ENUM('tithe', 'offering', 'other') NULL DEFAULT NULL AFTER name;

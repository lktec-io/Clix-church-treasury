-- Swahili becomes the default SMS/notification language for tenants.
--
-- WHY THIS EXISTS: tenants.locale_default was created as
-- `VARCHAR(5) NOT NULL DEFAULT 'en'` (0001_create_tenants.up.sql). Every SMS
-- resolves its language as:
--     contributor.locale ?? tenant.locale_default ?? 'en'
-- and because locale_default is NOT NULL, the third fallback is unreachable
-- and the second ALWAYS returned 'en'. The Swahili templates in
-- smsTemplates.js were therefore never rendered for any tenant — every
-- member received English regardless of the templates being present.
--
-- Two changes, both non-destructive (no rows removed, no columns dropped):
--   1. New tenants default to 'sw'.
--   2. Existing tenants still sitting on the original 'en' default are moved
--      to 'sw'. Scoped to `WHERE locale_default = 'en'` so any tenant
--      deliberately set to another locale is left untouched.
--
-- Per-contributor overrides (contributors.locale) are NOT touched — a member
-- who explicitly wants English keeps it.

ALTER TABLE tenants
  ALTER COLUMN locale_default SET DEFAULT 'sw';

UPDATE tenants
   SET locale_default = 'sw',
       updated_at = updated_at
 WHERE locale_default = 'en';

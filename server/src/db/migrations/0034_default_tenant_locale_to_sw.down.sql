-- Reverts 0034. Restores the original 'en' column default and moves tenants
-- currently on 'sw' back to 'en'.
--
-- NOTE: this cannot distinguish a tenant that was flipped by the up-migration
-- from one an administrator deliberately set to 'sw' afterwards — both go
-- back to 'en'. That is the honest limit of a reversible data migration here.

ALTER TABLE tenants
  ALTER COLUMN locale_default SET DEFAULT 'en';

UPDATE tenants
   SET locale_default = 'en',
       updated_at = updated_at
 WHERE locale_default = 'sw';

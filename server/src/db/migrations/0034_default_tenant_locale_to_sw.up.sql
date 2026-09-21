ALTER TABLE tenants
  ALTER COLUMN locale_default SET DEFAULT 'sw';

UPDATE tenants
   SET locale_default = 'sw',
       updated_at = updated_at
 WHERE locale_default = 'en';

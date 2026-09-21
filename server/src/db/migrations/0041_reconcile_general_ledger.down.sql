-- Deliberately does nothing to the schema.
--
-- 0041 repairs a database to the shape the code needs. "Reversing" that
-- would mean putting back the wrongly-shaped journal tables and removing
-- columns every contribution writes — i.e. breaking income recording again
-- on purpose. Rolling this migration back only removes its row from
-- schema_migrations; re-applying it is then a no-op, because every step in
-- 0041 checks before it acts.
--
-- To remove the ledger tables themselves, roll back 0037, which owns them.

DO 0;

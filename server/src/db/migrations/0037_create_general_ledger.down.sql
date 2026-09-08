-- FKs first, then the tables that own them, in dependency order.
ALTER TABLE categories DROP FOREIGN KEY fk_categories_gl_account;
ALTER TABLE categories DROP COLUMN gl_account_id;

ALTER TABLE accounts DROP FOREIGN KEY fk_accounts_gl_account;
ALTER TABLE accounts DROP COLUMN gl_account_id;

DROP TABLE IF EXISTS journal_lines;
DROP TABLE IF EXISTS journal_entries;
DROP TABLE IF EXISTS chart_of_accounts;

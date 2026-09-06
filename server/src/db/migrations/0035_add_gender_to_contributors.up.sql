-- The bulk member import template carries a Gender column, so the directory
-- needs somewhere to put it. Modelled on 0029's report_group: an ENUM with a
-- NULL default, so every existing contributor row is untouched and the field
-- stays genuinely optional — a church importing a member list that has no
-- gender column is not forced to invent one.
--
-- 'unspecified' is a distinct value from NULL on purpose: NULL means "never
-- recorded", 'unspecified' means "asked and declined to state". Collapsing
-- the two would lose that difference on a directory of real people.
ALTER TABLE contributors
  ADD COLUMN gender ENUM('male', 'female', 'unspecified') NULL DEFAULT NULL AFTER email;

---
'@adminium/server': patch
'@adminium/engine': patch
'@adminium/dashboard': patch
---

On SQLite, a change that has to rebuild a table with a unique column no longer fails with "object name reserved for internal use". An app update that adds a column or a choice value to such a table now goes through, and the column stays unique afterwards. Turning "Unique" off in the table designer now really lets duplicates in; before, the rebuild put the unique back and said the change was applied. A rebuild now puts a partial unique index (`WHERE deleted_at IS NULL`) and an index on an expression back as they were, and refuses, naming the column or the index, rather than quietly lose a column's collation (`COLLATE NOCASE`), a unique's `ON CONFLICT` rule, or a partial index on a column the change drops.

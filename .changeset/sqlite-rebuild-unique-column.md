---
'@adminium/server': patch
---

On SQLite, a change that has to rebuild a table with a unique column no longer fails with "object name reserved for internal use". An app update that adds a column or a choice value to such a table now goes through, and the column stays unique afterwards.

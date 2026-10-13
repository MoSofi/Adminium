---
'@adminium/server': patch
'@adminium/dashboard': patch
---

The menu offers **Import data** only to somebody who can bring a file in to at least one table. The session bootstrap says so in a new field, `canImport`: true for a Super Admin, and for a role that holds the import on a table (by name or by a wildcard) of a connection that is neither paused nor read-only; a table of a part of an app that is switched off does not count. It is a hint for the menu: the page still opens by its address, and the import itself is judged for the table chosen, as before.

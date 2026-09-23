---
'@adminium/engine': patch
'@adminium/manifest': patch
'@adminium/server': patch
---

**An app update can add a link to a table it already has.**

A new version of an app that adds an optional link column to one of its existing tables (an order
pointing at a customer, say) used to be refused with "cannot be added to a table that already
exists". It now installs: the column is added empty and linked to its table, on SQLite, PostgreSQL
and MySQL alike, and on SQLite without copying the table. A link every row must have is still
refused before anything changes, because the rows already there would have nothing to point at.

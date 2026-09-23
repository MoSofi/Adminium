---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/ui': patch
'@adminium/manifest': patch
'@adminium/engine': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

**App manifests can name their tables and columns in every language, and dashboards gain a day control.**

A manifest's tables take `label`, `labelPlural` and `keyField`, its columns a `label`, and enum
columns a label per value — plain text or a map keyed by language. Forms, grids, filters and
dashboard cards use them, in the viewer's language.

A dashboard page can show **Today / Yesterday / This week / Pick a day**; every card reads the
chosen day on the venue's clock, and hourly bars are labelled by hour. `SegmentedControl` takes
an `itemClassName`.

Fixes: SQLite boolean updates, a SQLite `now` default on the server's wall clock, SQLite schema
edits after another program changed the database, a public key's scope refreshing when the
connection's time zone or currency changes, and a revoked key no longer answering after an
uninstall.

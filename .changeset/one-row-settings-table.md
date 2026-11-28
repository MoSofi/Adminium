---
'@adminium/manifest': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

An app's one-row settings table keeps one row. A create there is refused while the table holds its row, and a batch of more than one row is refused outright, whichever door it came through: a records page, a file brought in, a rule's step, the Designer, a tree, an API key. The refusal is `409 ONE_ROW_TABLE`: "This table holds the app's settings: it has one row. Edit that row.", in all eight languages. A one-row table is the app's `outbox.settings.table`, an add-on's `settingsTable`, or a table one of the manifest's settings is read from (`oneRowTables` in `@adminium/manifest`). A second shop is a second install on another database, never a second row.

Every reader of such a table now takes the same row: the first by primary key, the row a Settings page edits. Before, most readers took whichever row the database handed back first, a public switch was on only while every row was on, and a moment or a payment's currency read nothing at all once there were two rows. A table that already holds two rows reads its lowest-key row everywhere.

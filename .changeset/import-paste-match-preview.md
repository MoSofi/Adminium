---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

The import wizard takes rows pasted from a spreadsheet (tabs, semicolons, with or without a row of names), matches lines on a column so a row that is already in the table is left as it is (`skip`) or updated, and shows what will happen to each line before it runs: new, already here, or refused with its reason (`GET /imports/:id/preview`). For somebody held to some rows, a line that matches a row they do not reach is refused as `ALREADY_EXISTS` rather than failing in the database. The kit's `ImportWizard` gains `matchOn`.

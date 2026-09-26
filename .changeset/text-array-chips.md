---
'@adminium/widgets': patch
'@adminium/engine': patch
---

A Postgres `text[]` or `varchar[]` column is edited as a list. The form showed it as a plain text box holding the array's text, and saving anything typed there failed, because Postgres reads `red,blue` as no array at all. Such a column is now marked a list when its page is generated or its table's facts are read, the form edits it as chips — one per item, duplicates refused, at most fifty — and it is saved as the database's own array. MySQL and SQLite have no array columns, so nothing changes there.

---
"@adminium/server": patch
"@adminium/engine": patch
"@adminium/manifest": patch
---

An app whose foreign key points at a table the database already has (a loyalty app on a shop's own `customers`) installs, with the foreign key to that table. Its install used to fail with an internal error, while `app check` passed it. `app check` now prints a `!` for such a link: the app installs only on a database with that table, and anywhere else the install refuses it by name (`UNRESOLVED_REFERENCE`).

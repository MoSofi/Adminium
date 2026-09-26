---
'@adminium/server': patch
'@adminium/widgets': patch
'@adminium/dashboard': patch
---

A Postgres table whose connection role is granted only some of its columns — `GRANT UPDATE (notes) ON tickets` — can now be edited. Forms show the columns the role may not set read-only and never send them: on an edit, the columns it may not update; on a new record, the columns it may not insert. A write that names such a column anyway is refused with 403 `READ_ONLY_MODE` listing the columns, before it reaches the database. A column Adminium fills on its own — an `updated_at` it stamps on every edit — is left out when the role may not write it, where it used to make the database refuse every save of the table.

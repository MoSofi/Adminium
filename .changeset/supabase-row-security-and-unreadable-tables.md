---
'@adminium/server': patch
'@adminium/adapter-postgres': patch
'@adminium/docs': patch
---

A PostgreSQL role that may not read a table no longer breaks the admin over it. Introspection leaves out every table the role may not read and every schema it may not use (Supabase's `auth` and `storage`, to a role of the app's own), names them in `schemas-unusable` and `tables-unreadable` warnings, and drops the keys that point at them, so no page is generated over a table whose every query would fail. A list or record whose looked-up column the database refuses now loads, with that column empty and marked, instead of failing whole. A read the database refuses answers `403 SOURCE_READ_REFUSED`, naming the schema or table, instead of saying the role may not change the table. The PostgreSQL guide has a new section on Row Level Security: why a Supabase or Lovable app's tables look empty to the recipes' roles, and how to give Adminium's role `BYPASSRLS` or a policy.

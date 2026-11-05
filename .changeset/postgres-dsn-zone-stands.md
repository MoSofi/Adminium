---
'@adminium/adapter-postgres': patch
---

A Postgres connection whose DSN names its own session zone (`?options=-c TimeZone=UTC`) keeps it: Adminium puts its data sessions in the server process's zone only when the DSN names none.

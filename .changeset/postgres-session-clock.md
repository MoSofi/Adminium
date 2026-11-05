---
'@adminium/adapter-postgres': patch
---

A Postgres database kept in another time zone than the Adminium server no longer stamps a time column's own default hours off: each data session keeps the server's clock, as the times Adminium writes do.

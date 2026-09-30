---
'@adminium/server': patch
---

On a SQLite connection the staff API now answers a time as the instant it is (`2026-07-28T23:59:17.183Z`), as the public API and Postgres and MySQL already did. It answered the server's wall time with no zone (`2026-07-29 01:59:17.183` on a server in Berlin), so a desk in another zone read every time hours off. Rows, lists, saves and live updates all carry the instant; a venue's own local times are left as they are. A form that sends a time back as it was shown is not taken for a change.

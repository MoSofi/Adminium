---
'@adminium/server': patch
---

A filter on a time kept without a zone (a Postgres `timestamp`, a MySQL `DATETIME`, a SQLite timestamp) now reads a value sent with a zone, like `2026-07-27T23:00:00.000Z`, as the moment it names. Adminium keeps such a column on the server's own clock, but the filter compared the value's clock numbers as they were, so on a server not in UTC it matched rows hours off, on every engine. The dashboard's own filter bar sends a plain day and was not affected; API callers and saved filters were. A widget's rolling window over such a column ("the last 7 days", "the last hour") is now counted on the server's clock too: on MySQL and SQLite it was counted on UTC's, and so shifted by the server's offset.

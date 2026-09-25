---
'@adminium/manifest': patch
'@adminium/server': patch
---

A formula can count the hours between two moments of its row: `{ "hoursBetween": ["started_at", "stopped_at"] }` works a time entry out as 2.50 for 09:15 to 11:45, rounded to the column's places, on Postgres, MySQL and SQLite. The hours are the time that really passed: a time kept without a zone is read on the server's clock, so the night the clocks change counts an hour less or more. An empty start or stop, or a stop before its start, leaves the hours empty rather than negative.

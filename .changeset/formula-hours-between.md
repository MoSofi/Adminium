---
'@adminium/manifest': patch
'@adminium/server': patch
---

A formula can count the hours between two moments of its row: `{ "hoursBetween": ["started_at", "stopped_at"] }` works a time entry out as 2.50 for 09:15 to 11:45, rounded to the column's places, on Postgres, MySQL and SQLite. The hours are the time that really passed: a time kept without a zone is read on the server's clock, so the night the clocks change counts an hour less or more. A stop stamped `now`, and a time sent without a zone for a column that keeps one, are counted as the moment that is stored. On SQLite a start filled by `unixepoch()`, and a text with its zone after a space, are read as the moments they are. An empty start or stop, a day the calendar does not have (30 February), or a stop before its start, leaves the hours empty rather than wrong. Hours the column cannot hold are refused with 422 `VALIDATION_FAILED`, the code `out-of-range` on the moments they are counted from, on every engine; so is any formula whose result its column cannot hold.

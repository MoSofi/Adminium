---
'@adminium/server': patch
---

A chart's week, month, quarter and year name the same day on every database: the period's first day at midnight UTC. Postgres cut them on the database's own clock (the host's zone when none was set), so July came back as 30 June 22:00Z on a server in Berlin and a screen put July's figure under June. A `date` column is cut as the days it holds. A column of times is cut on the connection's time zone where it names one (the venue's month, as its hours and days already were), on the UTC calendar where it names none. An hour of an instant is said with its zone on MySQL and SQLite, so a server off UTC does not move it.

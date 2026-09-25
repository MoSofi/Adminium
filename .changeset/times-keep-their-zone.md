---
'@adminium/engine': patch
'@adminium/server': patch
---

A time written to a column that keeps a zone (a Postgres `timestamptz`, a MySQL `TIMESTAMP`) now keeps its zone for the whole write, on every engine: a `now` stamp or fill is the instant itself, and MySQL's UTC wall time is spelled only as the value reaches the database. A time sent without a zone for such a column is read on the Adminium server's clock — the clock Adminium already keeps zone-less times on — rather than in whatever zone the database's session was in: on Postgres that zone was never set by Adminium, and on MySQL it was UTC. Stamps, date bounds, slot and booking guards, and formulas all read the moment that is stored.

A `default: "now"` in an app's manifest is filled by Adminium on every create, on every engine. On MySQL the table gets no database default for it any more (nor does a timestamp given "the current date and time" in Studio): the column is a `DATETIME` kept on the server's clock, and the database, its session in UTC, filled UTC's wall time instead — hours off wherever the server is not in UTC. A row written to such a table outside Adminium that leaves the column out now gets nothing there: it stays empty, or is refused if the column may not be empty. Adminium also fills a MySQL `DATETIME` whose database default is `CURRENT_TIMESTAMP` (one made before this, or one of your own) on its own creates. Adding such a column, not empty, to a MySQL table that has rows is refused, as it is for any column with no default.

A yes or a no is stored as the answer it names on every engine (SQLite used to keep `on` or ` true` as text), and `y` and `n` are read as Postgres reads them. Renaming a column in Studio now also renames it inside the rules of its table that read it: a `requiredWhen`, a `copy`'s link, a `notBefore` date, a formula. A public batch update reads the row through the caller's scope whenever a rule needs it, so a refusal never tells a stranger what a row they cannot see holds.

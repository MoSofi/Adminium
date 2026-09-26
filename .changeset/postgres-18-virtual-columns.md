---
'@adminium/adapter-postgres': patch
---

A Postgres 18 generated column is read as generated whether it is stored or virtual. Postgres 18 added virtual generated columns, and made them what a plain `GENERATED ALWAYS AS (…)` without `STORED` creates; Adminium read only stored ones as generated, so a virtual one showed as an ordinary column, its form offered a field for it, and saving any row of that table failed because Postgres refuses a value for a generated column. It now shows read-only like any other generated column, and saves leave it out. CI runs the adapter's live suites on Postgres 18 as well as 16.

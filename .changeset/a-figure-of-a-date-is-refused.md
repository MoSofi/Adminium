---
'@adminium/server': patch
---

A figure over a date or a time column is refused instead of answering `0`. `min`, `max`, `sum`, `avg` and `percentile` of a `date`, `time` or timestamp column answer `422` with `details.reason: "not-a-number"`, the column and the aggregation, and say what to ask instead: a `record-list` ordered by the column with a limit of 1. `count` and `count_distinct` are unchanged.

---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

A table whose rows take a resource for a whole day (`occupies` with `day`) can now name the last day too. With `until`, a row takes every day from its `day` to its `until`, both counted, and an empty `until` means it has no end. No two counted rows of one resource may share a day, so a person cannot have two covers that overlap, and a cover "until further notice" blocks every later one. The overlap is refused with `BOOKING_TAKEN`, and an `until` before its `day` with `BOOKING_OUT_OF_RANGE`. Needs Adminium 0.3.28.

---
'@adminium/server': patch
'@adminium/meta': patch
---

A "record created" rule now claims a row by its key and its `created_at`, so a row deleted outside Adminium and a new row given the same key (SQLite reuses a deleted top rowid) runs the rule, while a changed row never runs it twice.
A rule's write may name a sample person when the row that started the run is a sample row (never on a real row), and the rows such a run creates are listed with the sample, so "Remove sample data" takes them too, but never a rule-made row somebody has written a row of their own under.

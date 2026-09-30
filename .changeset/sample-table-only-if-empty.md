---
'@adminium/server': patch
'@adminium/manifest': patch
---

A sample-data table can be marked `"onlyIfEmpty": true`: its rows go in only when the table holds none. Online Ordering's opening hours (one row a weekday, each weekday unique) stopped "Add sample data" for a kitchen that had already set its hours; now the sample leaves the hours alone and adds the rest. No sample row may point at a row of such a table.

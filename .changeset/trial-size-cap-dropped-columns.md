---
'@adminium/server': patch
'@adminium/meta': patch
---

A trial's size cap keeps the most rows a MySQL table held while it kept a dropped column's values in the operator tallies, not in memory alone, so after a restart the rows deleted before it no longer count again. On MariaDB, which shows no sign of a column dropped in place, every InnoDB table now counts at least its pages in the share of its rows still there, so a dropped column's values count there too. Operator tallies can be raised to a highest amount and listed by name prefix.

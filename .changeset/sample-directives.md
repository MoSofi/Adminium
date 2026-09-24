---
'@adminium/server': patch
'@adminium/manifest': patch
---

**Sample data that follows the clock.**

Sample rows can land on working days (`@workdays`), name a calendar day in the venue's zone, take
a different status depending on whether their time has passed (`@byClock`), or be left out
(`@skip`). Totals are settled after the load, so sample fees, payments and balances agree.

A sample row that would repeat a unique value one of the operator's own records already holds (a
weekday's opening hours, say) now stops the add with `SAMPLE_ROW_CLASH`, naming the table, the
column and the value, instead of the database's own error. Nothing of the add is kept.

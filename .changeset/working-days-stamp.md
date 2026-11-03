---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

A stamp may write a date so many working days on: `set: { addWorkingDays: { from, days, map?, weekdays, cutoff?, closures? } }`. The order is received on the venue's day of `from` (`now`, or a date or moment of the row) when that is a working day before the cut-off, else on the next working day; the date is the `days`-th working day after it. The working week and the cut-off are stated, or name one of the app's own `string` settings (a saved value nobody can read falls back to the declared default; with none the write is refused `unreadable-setting`, never counted in calendar days). A closures table's active rows are read in the write itself, so a quote gives the date the save stores. More than 400 working days is refused `out-of-range`. Studio's column inspector names the rule.

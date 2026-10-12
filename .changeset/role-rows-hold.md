---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/widgets': patch
---

A role's row limits are stored only where they hold. Saving a role refuses a limit for an action the table's own grant does not give, a limit on a table that is not there, is private or does not say whose its rows are, an "only while" on a column that is hidden or missing, and a save that would take a limited table's own grant away while a wider grant still gives it. The preview of how many rows a person would reach is answered only to somebody who reads the table. The Rows dialog no longer gives a role back an action it lost, saves against the grants as they are now, and keeps an app's "only while" when "Every row" is chosen. A live list no longer drops a row when a file is attached to it: a row handed to a colleague arrives marked, and only the mark lets go of it.

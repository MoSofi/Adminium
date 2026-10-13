---
'@adminium/server': patch
---

A code marked as one no staff member reads (`code.hiddenFromStaff`) is now left out of what the data routes answer too: a list, one record, a record's history and a write's reply, for every role and the Super Admin. Until now only exports, search, live updates and dashboard cards left it out.

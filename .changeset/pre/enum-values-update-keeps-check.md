---
'@adminium/server': patch
---

**An app update that adds a choice to a column keeps the column's list of allowed values.**

On PostgreSQL and MySQL, an update adding a value (a new payment method, say) removed the column's
check and never put it back, so any value was accepted afterwards, while the change was recorded as
applied. The check is now replaced with the full new list. A schema change whose statement cannot be
built now fails instead of being recorded as applied.

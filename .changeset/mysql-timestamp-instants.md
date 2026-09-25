---
'@adminium/server': patch
'@adminium/adapter-mysql': patch
---

MySQL `TIMESTAMP` columns hold the right instant whatever zone the database server or Adminium runs in. Writing a date and time to one through the API or a form no longer fails, and "still ahead", time windows, "from today", filters, reminders and an app email's due and sent times compare against the right hour. Values read back are no longer shifted, and an undo puts back the time it read. Adminium's connections to MySQL and MariaDB now run their session in UTC, so `NOW()`, `CURRENT_TIMESTAMP` and triggers inside Adminium's own statements run in UTC too. A `DATETIME` column that defaults to `CURRENT_TIMESTAMP` or updates on `CURRENT_TIMESTAMP` gets the UTC time for rows Adminium writes. `{"$generate":"now"}` in a public scope writes this server's clock into a column with no zone, the way a column rule's `now` does.

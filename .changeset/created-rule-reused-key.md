---
'@adminium/server': patch
'@adminium/meta': patch
---

A rule that runs when a row is made now also runs for a row that gets the key of a row deleted before it. On SQLite, deleting the newest row hands its number to the next row, and that row's rules never ran: in the Sales CRM a deal made just after the newest deal was deleted got no mark and no first history line. Deleting a row through Adminium now lets go of what its rules remembered of it; the earlier runs and their history stay.

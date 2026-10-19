---
'@adminium/server': patch
---

The daily files sweep now checks whether a record already names an unclaimed upload before sending it to the trash, and gives the upload to that record. Before, a save whose file bookkeeping failed for a moment after the record was written (the settings database briefly unavailable) left the upload unclaimed, and the sweep trashed it a day later while the record still showed it.

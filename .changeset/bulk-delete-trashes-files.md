---
'@adminium/server': patch
---

Deleting records in bulk now sends each record's files to the trash, and its Undo brings them back, as deleting one record does. Before, the files of bulk-deleted records stayed attached to rows that no longer existed and were never cleaned up. A bulk edit of a file column now also keeps the new file with its record and sends the replaced one to the trash.

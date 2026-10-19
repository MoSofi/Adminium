---
'@adminium/server': patch
---

A record whose file column names a file that belongs to another record, or to the Files library, no longer takes that file over. Before, pasting another row's picture link or a library file's link moved the file onto the new row: the first row lost the picture on its own pages, the library lost the file, and clearing or deleting the new row sent the file to the bin. The file now stays where it was. A record with a very long key also no longer re-attaches its own file on every save.

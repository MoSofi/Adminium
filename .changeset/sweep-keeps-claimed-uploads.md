---
'@adminium/server': patch
---

The daily files sweep no longer sends an upload to the trash when a save names it while the sweep is running, and a save no longer claims an upload that is already in the trash, which left a record pointing at a file due to be deleted.

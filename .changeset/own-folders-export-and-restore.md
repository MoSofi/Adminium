---
'@adminium/server': patch
---

The data folder's Export everything work folder (`.export-everything`) and the folders an archive restore unpacks into (`.archive-restore-…`) are now Adminium's own, like `backups`: a SQLite source or a local file storage folder can no longer be placed inside them. Every start empties the Export everything folder, so files kept there were lost.

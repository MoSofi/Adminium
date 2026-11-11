---
'@adminium/server': patch
---

A SQLite source can no longer open Adminium's own files. The meta store's file, its `-wal`, `-shm` and `-journal` files, and anything in the data directory's `backups/`, `files/`, `tmp/`, `add-ons/` and `pre-restore-…` folders are refused on every way in: Studio's connect screens, the desktop app's "Open an existing SQLite file", `ADMINIUM_SOURCE_URL` (which now stops the boot with the reason) and a project's databases. A symlink, a hard link, a `..` in the path or the name in other letter case is caught too. Your own files in the data directory, such as a project's `data/app.sqlite` or the desktop app's databases, open as before. The new `ADMINIUM_SQLITE_DIRS` variable lets a server's operator name the folders SQLite sources must live in; unset, any other file is allowed, as before. The desktop app ignores it.

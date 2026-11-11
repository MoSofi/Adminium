---
'@adminium/server': patch
---

An export file decides less on the server that imports it. A `local` storage destination in it comes back switched off, and the files that were in it land in `<data dir>/files` instead of the folder the file names. A full archive's connection strings are checked on restore as when they are saved: the host is looked up where production or `ADMINIUM_NETWORK_POLICY=strict` refuses this server's own addresses, and `ADMINIUM_DATABASE_HOSTS` is honoured.

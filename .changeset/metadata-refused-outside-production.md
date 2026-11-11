---
'@adminium/server': patch
---

A source database's host name is now looked up outside production mode too (the desktop app, `adminium dev`, Adminium run with `npx`), and a name that points at a cloud metadata address is refused there as it is in production. Nothing else changes there: the server itself and your own network stay allowed, and a name that does not resolve, because you are offline for example, is left for the database driver to report as before.

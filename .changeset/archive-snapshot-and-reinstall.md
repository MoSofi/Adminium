---
'@adminium/server': patch
'@adminium/meta': patch
---

`adminium archive create` now reads the meta store inside one read-only transaction (SQLite one transaction, Postgres REPEATABLE READ READ ONLY, MySQL a consistent snapshot), so an archive of a running instance holds every table as it was at one moment: a row written while the archive is being made is in all of its tables or in none, never a child without its parent. Studio's "Download everything" gets the same.

A new operator call, `POST /api/v1/operator/reinstall`, downloads again every catalog app and add-on that is installed but whose files are not on this server, as after `adminium archive restore` or a deploy that emptied the data directory, so they stop showing as Missing without anyone pressing Download. Each package is fetched at its installed version and checked as Studio's Download checks it, and the call is audited as the server operator. It answers with what came back, what was already here and what failed with the reason (a version the catalog no longer offers, the catalog switched off), and one failure never fails the call.

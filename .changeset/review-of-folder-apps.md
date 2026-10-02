---
'@adminium/server': patch
'@adminium/engine': patch
'@adminium/meta': patch
---

Close what the review of running an app from its project folder found. A
SQLite table rebuild that drops a column now needs Super Admin, as a plain
column drop always did. A removal question is answered against the manifest
the app runs on now, never an older one; a column of a table another app or an
add-on uses is never dropped; a failed read is never taken for an empty table.
A column the app stops declaring and keeps is made optional, so it cannot
refuse new rows. A project's `.env` cannot switch a server into dev mode.
Setting `apps.<key>.publicAccess` is applied on the next start by itself, and a
server says when an app has public access its config does not allow.

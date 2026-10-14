---
'@adminium/server': patch
---

A role's `writable` list now holds for a json column on Postgres and MySQL. Those drivers answer a json value as an object, and any two objects compared as unchanged, so a limited role could rewrite a json column outside its list (SQLite refused it). The value sent is now compared as a document with the one stored, in any key order; anything in doubt counts as a change.

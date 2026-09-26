---
'@adminium/engine': patch
'@adminium/adapter-postgres': patch
'@adminium/server': patch
---

A Postgres connection whose role may read and write rows but not create tables — the least-privilege role recommended for a production database — is no longer read-only. Adminium decided a connection was read-only when its role could not create a table in the default schema, so such a role could never save a row, even on tables it was granted `INSERT`, `UPDATE` and `DELETE` on. A connection is now read-only only when the role can write no table at all (and cannot create one), or when the server is a standby or the role's transactions are read-only by default. Where a role may write some tables and only read others, Adminium reads its grants per table: a table it may not change offers no New, Edit or Delete, a write to it is refused with 403 `READ_ONLY_MODE` before it reaches the database, and an import into it is refused before it starts. A write the database itself refuses for want of a right — a grant revoked in the last minute, a link row, a parent's total, an undo, or a MySQL table-access refusal — is the same 403 instead of a 500. Loading a page never waits on the source database to learn its grants. A connection added before this release keeps the read-only flag its last test gave it: press Test on the connection once to have it read again.

---
'@adminium/server': patch
---

Studio no longer offers schema changes on a connection whose role cannot make them. A connection test has always worked out whether the role may run DDL, and every place that stored the result dropped that part — creating a connection, testing it again, a project's databases at start, the seeded source connection and the desktop's local databases — so it was never recorded, and an unrecorded answer counts as "yes". A least-privilege role with no `CREATE` was offered the schema editor, and every change it made was refused by the database. The answer is now recorded wherever a test result is; an existing connection picks it up the next time it is tested, or at the next start for a project's databases.

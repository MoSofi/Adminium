---
'@adminium/meta': patch
---

**The Postgres migration lock survives a transaction pooler.** It is now
`pg_try_advisory_xact_lock` taken inside one explicit transaction that the whole
migration pass runs in, rather than `pg_advisory_lock` on a pinned session.

The old shape was correct against a direct Postgres and silently useless behind
pgbouncer — which is Neon's `-pooler` endpoint, Supabase's 6543 and Fly's
pgbouncer, the connection string every one of those providers shows first.
`db.connection()` pins the *client* connection; a transaction-mode pooler hands
the *server* backend back at the end of every transaction, and every statement
sent outside one is its own transaction. So the lock was held by a backend the
next statement might not be on: `pg_try_advisory_lock` returned true for both
booting replicas, each on its own backend, and the pass this lock exists to
serialize ran twice, in silence — the failure the module's own header calls the
classic `GET_LOCK` footgun, arriving through the pooler rather than through the
pool. It also leaked: the backend holding the lock is not ours to close, so it
stayed taken after we disconnected, and a later boot could find the key
permanently held and time out against nobody.

A transaction is exactly the unit a transaction-mode pooler pins a backend for,
so the lock and the work it guards now stay together by construction, and the
lock cannot outlive the transaction that took it. The lock key is unchanged on
purpose: session and transaction advisory locks contend on the same lock object,
so a rolling upgrade still serializes an old process against a new one.

One consequence, and it is an improvement: on Postgres the pass is now one
transaction rather than one per migration — what SQLite has always done — so a
pass that fails half way leaves nothing behind instead of leaving the migrations
before the failure applied.

MySQL is unchanged and cannot be fixed the same way: `GET_LOCK` is
session-scoped, there is no transaction-scoped equivalent, and no transactional
DDL to hang one on. Behind a transaction-pooling proxy a MySQL meta store cannot
serialize migrations; the meta-store guide now says so.

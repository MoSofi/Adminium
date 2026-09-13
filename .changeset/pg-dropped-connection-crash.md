---
'@adminium/server': patch
'@adminium/adapter-postgres': patch
---

**A dropped Postgres connection no longer takes the server down.** Reported
against 0.2.6: onboarding moved the meta store onto a remote Postgres, and a
while later the process died with

    Error: read EADDRNOTAVAIL
    Emitted 'error' event on BoundPool instance at: Client.idleListener

`pg` reports a connection that dies as an `'error'` event, and an `'error'`
event with no listener is an uncaught exception, so the process exits. Anything
that ends a connection can trigger it: a laptop's network changing (macOS raises
EADDRNOTAVAIL), a provider's idle cutoff, a failover, `pg_terminate_backend`.
Which emitter reports the death depends on where the client was:

- **idle in the pool**: the pool emits. The meta store's pool had no listener at
  all, and this was the reported crash. The data pool that reads rows already
  had one.
- **checked out**: the client itself emits. pg-pool detaches its own listener
  for the checkout and kysely never attaches one, so a connection lost under a
  running statement, inside a transaction, or handed out again before the pool
  noticed crashed the process through **both** pools. The meta store holds a
  client for a whole migration pass and for a relocation's copy.

Both pools now listen on the pool and on every client. A statement that was
running still rejects with the error, where it is reported, and the next checkout
opens a fresh connection. MySQL is unaffected: every `mysql2` pool connection
already listens for its own errors.

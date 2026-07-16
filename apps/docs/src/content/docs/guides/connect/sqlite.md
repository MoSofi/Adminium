---
title: Connect a SQLite database
description: File paths, read-only mode, WAL, and foreign-key enforcement when connecting Adminium to a SQLite file.
---

SQLite is a file, which makes it the easiest engine to connect and the one with
the most surprising failure modes. Both facts come from the same place.

## Connection string

```
sqlite:/absolute/path/to/app.db
```

An absolute filesystem path also works on its own:

```
/var/lib/myapp/app.db
```

Use **absolute paths**. A relative path resolves against Adminium's working
directory, which is not the directory you typed the command in once the server
is running under Docker, `systemd`, or the Electron app.

:::caution[The file must be reachable by the Adminium process]
"On my machine" is not a location the server can reach. Under Docker, mount it
and use the container's path:

```bash
docker run -v /host/path/app.db:/data/app.db:ro …
# then connect to sqlite:/data/app.db
```
:::

## Read-only mode

SQLite has no roles, so read-only is a property of the **file mode**, not a
grant. Adminium opens the file read-only when the connection is configured that
way, and the probe reports it exactly as it does for a Postgres read-only role:

```
Connected — 2 ms · 3.45.1 · read-only
```

Mount the file `:ro` under Docker, or `chmod` it so the Adminium user cannot
write. The result is the same read-only app with a banner.

:::caution[A read-only file forces a separate meta store]
Adminium cannot write its `adminium_*` tables into a file it cannot write.
Same-database placement is refused with `META_PLACEMENT_INVALID` at connect
time. Since the default meta store is *also* SQLite, this is easy to miss: they
are two different files with two different purposes. See
[Read-only sources & the meta database](/guides/connect/read-only-and-meta/).
:::

## Two things about SQLite that will bite you

### Foreign keys are off by default

SQLite parses `REFERENCES` clauses and stores them, but does not *enforce* them
unless `PRAGMA foreign_keys = ON` on each connection. Adminium enables it on its
data connections, so relationships are enforced while Adminium is writing.

The catch: if your application never enabled it, your file may already contain
rows that violate their own foreign keys. Adminium will generate relationship
navigation from the declared keys and then find nothing at the other end. Audit
before you assume:

```sql
PRAGMA foreign_key_check;
```

### WAL mode changes what "the database" is

In WAL mode a database is **three** files — `app.db`, `app.db-wal`, and
`app.db-shm`. Copy only the first and you get a stale snapshot, silently. This
matters when you back up, when you mount into Docker, and when you copy a file
to "try Adminium on it".

Copy all three, or checkpoint first:

```bash
sqlite3 app.db 'PRAGMA wal_checkpoint(TRUNCATE);'
```

The safe copy is:

```bash
sqlite3 app.db ".backup '/tmp/snapshot.db'"
```

WAL also means readers do not block writers — which is *why* Adminium can read a
file your application is actively writing. Keep WAL on; just know what the
database consists of.

## What Adminium reads

Schema only: `sqlite_master` DDL, `PRAGMA table_info`, `PRAGMA foreign_key_list`,
and `PRAGMA index_list`. SQLite's dynamic typing means declared types are
advisory (`VARCHAR(255)` and `TEXT` and `WHATEVER` are all `TEXT` affinity), so
Adminium reads the declared type and maps by affinity rules. Where a column's
declared type is genuinely ambiguous, override the field type.

There are no native `BOOLEAN` or `DATETIME` types. Adminium infers from the
declared type name — `BOOLEAN` → boolean, `DATETIME`/`TIMESTAMP` → timestamp —
which is the convention every SQLite ORM follows.

## Concurrency

SQLite allows one writer at a time. In WAL mode that is rarely a problem for an
admin panel, but a long write from your application can make an Adminium save
wait, and vice versa. If you see `SQLITE_BUSY`, that is what happened.

## Not the same as the meta store

The default meta store is *also* a SQLite file, under your data directory. It is
unrelated to a SQLite file you connect as a data source. Two files, two jobs:

| | Path | Purpose |
|---|---|---|
| Data connection | wherever your app's database lives | your tables |
| Embedded meta store | `<data-dir>/…` | Adminium's `adminium_*` tables |

## Troubleshooting

**`unable to open database file`** — nine times in ten a path or permissions
problem: relative path, unmounted volume, or a directory the Adminium user
cannot traverse. SQLite also needs write access to the *directory* (not just the
file) to create `-wal` and `-shm`.

**`database is locked`** — another process holds a write lock. See Concurrency.

**Schema looks stale** — you copied `app.db` without its `-wal`. See above.

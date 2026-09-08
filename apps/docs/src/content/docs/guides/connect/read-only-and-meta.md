---
title: Read-only sources & the meta database
description: Why a read-only data role forces a separate meta store, and how Adminium's three-connection model resolves the apparent contradiction.
---

Two promises appear to contradict each other:

- *"Use a read-only role. Adminium reads your schema, not your rows."*
- *"Adminium stores your users, roles, page config, and audit log."*

Both are true, because they are about **different connections**. This page is the
honest version of the story.

## The three connections

| Connection | Points at | Access needed |
|---|---|---|
| **Data** | Your source database | Read. Write only if you want to edit records. |
| **Meta** | Adminium's own `adminium_*` tables | **Always read + write.** Non-negotiable. |
| **Introspection** | Your source database | Read, schema only |

The **data** connection can be read-only, and everything except record editing
still works. That does **not** mean Adminium writes nothing anywhere — it has to
persist your users somewhere, and several features write to the source database
when you ask them to:

- **Editing records** needs write access on the data connection.
- **Editing your schema** — creating, altering and dropping tables from
  Studio → Schema → Design — needs DDL privileges on it. A read-only connection
  simply does not offer that surface, and the API refuses it with
  `403 READ_ONLY_MODE` rather than failing halfway.
- **Importing a CSV** inserts or upserts rows, so it is refused on a read-only
  connection with the same `403 READ_ONLY_MODE`.
- **Undoing a change** replays the compensating write, so it needs the same
  access the original write did.

What is unconditional is setup: introspection reads catalog metadata only, never
your rows.

## The rule

> **A read-only data role means the meta store cannot live in that database.**

Not a recommendation. Adminium refuses same-database placement against a
read-only or DDL-less role, with `META_PLACEMENT_INVALID`, at the first instant
both facts are known: right after the capability probe, before anything is
stored.

It fires there rather than at first write because the alternative is a
successful-looking setup that collapses the moment someone tries to log in.

## The decision tree

```
Can the data role write, and does it have DDL?
│
├─ No (read-only, or no DDL)
│   └─► A SEPARATE meta store is MANDATORY.
│       • Another database on the same server, or
│       • A different server, or
│       • The embedded SQLite store (evaluation only)
│
└─ Yes
    │
    ├─ Is this production?
    │   │
    │   ├─ Yes ─► Use a separate database. Recommended.
    │   │         Adminium's migrations never touch your data server.
    │   │         You can back the two up on different schedules.
    │   │
    │   └─ No ──► Same database, dedicated schema, is fine.
    │             One thing to back up. One thing to lose.
    │
    └─ Just evaluating? ─► Embedded SQLite. It announces itself on boot.
```

## The three placements

### Embedded SQLite (the default)

A file under `ADMINIUM_DATA_DIR`. Zero configuration — it is what makes a fresh
`adminium` install work with nothing but a secret. Adminium prints a warning on
every boot so it can never be your production meta store by accident.

Fine for: a laptop, an evaluation, a demo, the desktop app.
Not fine for: anything with more than one user, or anything on a host you might
lose.

### Same database, dedicated schema

```sql
-- PostgreSQL
CREATE SCHEMA adminium AUTHORIZATION adminium_rw;
```

```sql
-- MySQL — a separate database, same server
CREATE DATABASE adminium_meta;
GRANT ALL PRIVILEGES ON adminium_meta.* TO 'adminium_rw'@'%';
```

Requires DDL on the data connection. One backup covers both. The trade-off:
Adminium's migrations run against the same server as your production data, and
your data server carries Adminium's load.

### A separate database (production)

```bash
export ADMINIUM_META_URL='postgres://adminium:pass@meta-host:5432/adminium_meta'
```

The meta store's engine is independent of your source engine — a MySQL source
with a Postgres meta store is perfectly normal. Adminium's own tables have their
own schema and their own migration ledger.

## What you lose with a read-only source

| Works | Does not |
|---|---|
| Browsing, filtering, sorting, search | Inline edit, create, delete |
| Detail pages, relationship navigation | Bulk actions that write |
| Dashboards, charts, widgets | Import |
| Exports | |
| Users, roles, RBAC, audit *(meta store)* | |
| Saved views, page config *(meta store)* | |

The app is not degraded — it is a read-only app, honestly labeled, with a banner.
Everything backed by the **meta** store still works, because that connection is
still read-write. That is the whole reason the two are separate.

**Attachments are on the meta side, so they still work.** Enable attachments for
a table in Studio and its record pages accept uploads even on a read-only
connection: the bytes go to Adminium's own storage, and the row tracking them —
filename, size, checksum, and the connection, table and record it belongs to —
lives in `adminium_files` in the meta store. No column is written and no write
reaches your database, so there is nothing for a read-only role to refuse.
Adminium still checks that *you* may update that table, but that is a role
permission of its own, not a database privilege. The other way to bind a file —
storing its URL or id *in one of your own columns* — is an ordinary record
write, and it is refused here like every other one. See
[Files & attachments](/guides/files/).

## Recommended posture

Connect a read-only role first. Look at what Adminium made of your schema. Then
grant writes to the tables you actually want editable — not to everything,
because you can:

```sql
-- PostgreSQL: read everything, write two tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO adminium;
GRANT INSERT, UPDATE, DELETE ON support_tickets, refunds TO adminium;
```

Adminium probes per-table capabilities and generates accordingly: `orders` shows
up read-only, `refunds` gets a Save button. The database is the enforcement
boundary, not the UI — which is the only place enforcement is worth anything.

## See also

- [Where to put the meta store](/self-hosting/meta-store/) — the self-hosting
  view: backups, migrations, upgrades
- [PostgreSQL](/guides/connect/postgres/) ·
  [MySQL](/guides/connect/mysql/) ·
  [SQLite](/guides/connect/sqlite/) — per-engine role recipes

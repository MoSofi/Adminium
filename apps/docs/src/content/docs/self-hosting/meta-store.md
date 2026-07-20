---
title: Where to put the meta store
description: The placement decision tree for Adminium's own tables — and why a read-only source makes a separate meta store mandatory.
sidebar:
  order: 4
---

Adminium keeps its own state — users, roles, connections, snapshots, page
config, saved views, audit log, jobs — in tables prefixed `adminium_*`. That is
the **meta store**, and it is a different thing from the database you are
building an admin panel for.

Where it lives is the most consequential self-hosting decision you make, and the
most annoying to change later.

## The decision tree

```
Can Adminium's data role WRITE, and does it have DDL?
│
├─ NO (read-only role, or no DDL)
│   │
│   └─► A SEPARATE meta store is MANDATORY.
│       Adminium enforces this: same-database placement is refused
│       with META_PLACEMENT_INVALID at connect time.
│
└─ YES
    │
    ├─ Production, or more than one user?
    │   │
    │   ├─ YES ─► SEPARATE DATABASE.  ← recommended
    │   │         Adminium's migrations never touch your data server.
    │   │         Independent backup schedules. Independent blast radius.
    │   │
    │   └─ NO ──► Same database, dedicated schema. Acceptable.
    │             One thing to back up — and one thing to lose.
    │
    └─ Just looking? ─► Embedded SQLite (the default).
                        It warns at every boot. Believe it.
```

## The rule that is enforced, not advised

> **A read-only data role means the meta store cannot live in that database.**

Adminium refuses same-database placement against a read-only or DDL-less role,
with `META_PLACEMENT_INVALID`, at the first instant both facts are known: right
after the capability probe, before anything is stored.

The alternative — accepting the configuration and failing at first write — is a
setup that looks successful and collapses when someone tries to log in.

Nothing else could work. Adminium must write its own tables; a role that cannot
write cannot host them. See
[Read-only sources & the meta database](/guides/connect/read-only-and-meta/) for
the full three-connection story.

## The three placements

### Embedded SQLite — the default

A file under `ADMINIUM_DATA_DIR`. Zero configuration; it is what makes a fresh
`adminium` install work with nothing but a secret.

It **warns at every boot**. That is deliberate: this fallback must never become
your production meta store by accident.

| Good for | Bad for |
|---|---|
| A laptop, an evaluation, a demo | More than one user |
| The desktop app | Anything on a host you might lose |
| CI | Anything you would be upset to re-create by hand |

If you use it, **the data directory is your database.** Back up
`ADMINIUM_DATA_DIR` as a database, not as a cache.

### Same database, dedicated schema

```sql
-- PostgreSQL
CREATE SCHEMA adminium AUTHORIZATION adminium_rw;
```

```sql
-- MySQL: a separate database on the same server
CREATE DATABASE adminium_meta;
GRANT ALL PRIVILEGES ON adminium_meta.* TO 'adminium_rw'@'%';
```

```bash
ADMINIUM_META_URL='postgres://adminium_rw:pass@your-db:5432/mydb'
```

Requires DDL on the data connection.

**For:** one backup covers everything. One database to operate. Genuinely simpler.

**Against:** Adminium's migrations run against your production data server.
Adminium's load lands on your production data server. A restore of your data
database rolls back your Adminium config with it — including your audit log,
which is exactly the thing you want to survive an incident.

### A separate database — recommended for production

```bash
ADMINIUM_META_URL='postgres://adminium:pass@meta-host:5432/adminium_meta'
```

The meta store's engine is independent of your source engine. A MySQL source with
a Postgres meta store is normal and fully supported. Adminium's tables carry
their own schema and their own migration ledger.

**For:** blast radius. Adminium's migrations never touch your data server; your
data server never carries Adminium's load; the two back up and restore
independently; a compromised source connection does not imply a compromised meta
store.

**Against:** one more database to run. That is the whole list.

With Docker Compose, `--profile with-meta` gives you one:
[Docker Compose](/self-hosting/docker-compose/).

## Two things people conflate

**"But my source database *is* SQLite."** Then you have two SQLite files with two
jobs: your application's database, which Adminium reads, and Adminium's meta
store, which Adminium writes. Unrelated files. Do not point them at each other.

**"Can't I just back up the meta store?"** Back it up, yes — but a meta-store
backup is unreadable without `ADMINIUM_SECRET`, since every stored DSN and API
key in it is encrypted under a key derived from that secret. Back up both, and
test the restore before you need it.

## Moving the meta store later

It is possible and it is work: dump the `adminium_*` tables, restore them into
the new store, point `ADMINIUM_META_URL` at it, keep the **same**
`ADMINIUM_SECRET` — or every encrypted value moves across as ciphertext you can
no longer read.

Cheaper to decide correctly now. If you are past "just looking", use a separate
database.

## See also

- [Read-only sources & the meta database](/guides/connect/read-only-and-meta/)
- [Environment variables](/self-hosting/env-vars/) — `ADMINIUM_META_URL`
- [Upgrading](/self-hosting/upgrades/) — forward-only migrations

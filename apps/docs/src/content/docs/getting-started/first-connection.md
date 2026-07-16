---
title: Connect your first database
description: What the connect flow asks, what the probe tells you, and why the meta-store question comes when it does.
sidebar:
  order: 4
---

Whether you use the setup wizard, the Studio UI, or the REST API, the connect
flow is the same set of decisions running through the same services. Here is
what each one is actually asking.

## Pick an engine

Adminium v1 ships adapters for three engines:

| Engine | Connection string |
|---|---|
| [PostgreSQL](/guides/connect/postgres/) | `postgres://user:pass@host:5432/db?sslmode=require` |
| [MySQL / MariaDB](/guides/connect/mysql/) | `mysql://user:pass@host:3306/db` |
| [SQLite](/guides/connect/sqlite/) | `sqlite:/absolute/path/to/app.db` |

Or skip the connection entirely and
[import a schema file](/guides/schema-import/) — a `pg_dump`, a
`schema.prisma`, a Rails `schema.rb`, and six other formats. No live database
required.

## The probe

Before Adminium stores anything, it connects and probes. You will see something
like:

```
Connected — 34 ms · PostgreSQL 16.2 · read-only role
```

Three facts, each load-bearing:

- **Latency** — a sanity check that you reached the database you meant to.
- **Server version** — Adminium adapts introspection to what the version
  supports.
- **Capabilities** — what your role can do: `canRead`, `canWrite`, `canDDL`.

That last one determines what you get. A role with `canRead` but not `canWrite`
produces a fully functional **read-only app** with a banner saying so. Adminium
does not offer you a Save button that will throw.

:::tip[Start read-only if you are evaluating]
Point Adminium at a read-only role first. You will see exactly what it makes of
your schema with no possibility of a write. Grant writes when you are convinced.
Per-engine recipes are on each connect page.
:::

## The meta-store question

Adminium needs somewhere to keep its **own** tables — users, roles, connections,
snapshots, page config, audit. That is the *meta store*, and it is a separate
concern from your data connection.

You have three options:

1. **Embedded SQLite** (the default) — a file under your data directory. Fine
   for a laptop or an evaluation. It announces itself on boot.
2. **The same database as your data**, in its own schema. Convenient, and
   requires your role to have DDL.
3. **A separate database.** The right answer for production.

One rule is enforced rather than advised:

> **A read-only data role means the meta store must live elsewhere.** Adminium
> refuses same-database placement in that case, with `META_PLACEMENT_INVALID`,
> at the moment both facts are known — right after the probe.

Nothing else could work: Adminium must write its own tables, and a role that
cannot write cannot host them. The full decision tree:
[Where to put the meta store](/self-hosting/meta-store/).

:::note[Why the CLI asks this first]
In the Studio, the meta question comes late — the Studio is already running, so
a meta store already exists and the question is about where it should live
*going forward*. The CLI has no such luxury: nothing can be persisted, not even
the connection row, until a meta store is open. So `npx adminium` resolves meta
placement before it asks about your database. The read-only rule still fires at
exactly the right moment; only the question's position moves.
:::

## Choosing tables

Blank or `all` includes everything Adminium found. Otherwise, give it a
comma-separated list — either fully-qualified (`public.orders`) or just the
table name (`orders`) when it is unambiguous.

You are not locked in. Re-run [`adminium introspect`](/reference/cli/#introspect)
after a schema change and the snapshot updates; if nothing changed, the checksum
matches and it is a no-op:

```bash
adminium introspect --connection <id>
# Schema unchanged — kept snapshot snp_… (24 tables).
```

## Choosing an intent

The intent shapes what gets generated:

| Intent | What you get |
|---|---|
| **Full admin** | CRUD on everything, dashboards included |
| **Read-only analytics** | Dashboards and browsing, no writes |
| **CRUD** | Data-entry screens, minimal dashboards |
| **Support console** | Lookup-first, focused on finding one record |

## PII masking is on by default

Introspection classifies columns and proposes masks for anything that looks
personal — emails, phone numbers, national IDs. It will tell you:

```
Proposed 7 PII mask override(s) — masking is on by default.
```

Masks are proposals you can review and change, but the default is masked, not
exposed.

## Next

- [PostgreSQL](/guides/connect/postgres/) ·
  [MySQL](/guides/connect/mysql/) ·
  [SQLite](/guides/connect/sqlite/)
- [Read-only sources & the meta database](/guides/connect/read-only-and-meta/)
- [Improve the generated app with an LLM](/guides/llm-assist/) — optional, and
  there is a path that sends nothing anywhere.

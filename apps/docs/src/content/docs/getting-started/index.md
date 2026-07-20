---
title: What is Adminium?
description: Adminium reads your database schema and interprets it at runtime as a read-and-write admin panel. Here is the model you need to hold in your head.
sidebar:
  order: 1
---

Adminium turns a database into an admin panel. You give it a connection string,
it reads the **schema** — table names, columns, types, foreign keys, indexes,
constraints — and interprets that model at runtime as a working application:
list views with filters, detail pages that follow relationships, inline editing,
dashboards, roles, and an audit log.

It never reads your rows to do this. Introspection is schema-only.

## The three ideas worth understanding up front

### 1. Runtime interpretation, not code generation

Most "admin generators" emit a codebase you then own and maintain. Adminium
does not. Your schema and your customizations live as **configuration** in
Adminium's own tables; the server reads that configuration on every request and
renders accordingly.

The consequence people ask about most: there is no source code to download. When
you run [`adminium export-zip`](/reference/cli/#export-zip), you get the server
plus its configuration bundle — enough to stand the same instance up somewhere
else, and nothing that resembles a generated app. This is deliberate, not a
limitation. See [Export & restore](/self-hosting/export-zip/).

### 2. Three connections, not one

This is the model that explains most of Adminium's behavior, and the one that
trips people up if they skip it.

| Connection | What it is | Who owns it |
|---|---|---|
| **Data** | Your source database — the one with your `orders` and `customers` tables. | You. Adminium connects with whatever role you give it. |
| **Meta** | Adminium's own tables (`adminium_*`): users, roles, connections, snapshots, pages, audit. | Adminium. It must be able to write here. |
| **Introspection** | The schema read that produces a snapshot. | Runs over the data connection, read-only. |

The **data** and **meta** connections are separate concerns that may or may not
point at the same database. That choice has one hard rule:

> If your data role is read-only, the meta store **must** live somewhere else.

Adminium enforces this at connect time rather than letting you discover it at
first write. Full decision tree:
[Where to put the meta store](/self-hosting/meta-store/).

### 3. Schema-only introspection, with your role as the ceiling

Adminium probes what your role can actually do (`canRead` / `canWrite` /
`canDDL`) and adapts. Hand it a read-only role and you get a fully functional
read-only app with an honest banner saying so — not a broken app that throws on
save. Details per engine:
[PostgreSQL](/guides/connect/postgres/) ·
[MySQL](/guides/connect/mysql/) ·
[SQLite](/guides/connect/sqlite/).

## No database handy?

You do not need a live connection. Adminium can build the same app from a
**schema file** — a `pg_dump`, a `schema.prisma`, a Rails `schema.rb`, Django
models, and five other formats. See
[Import a schema file](/guides/schema-import/).

## Where to go next

- [Quickstart from source](/getting-started/quickstart/) — run the CLI from a
  git checkout.
- [Run with Docker](/getting-started/docker/) — if you would rather not install
  Node.
- [Connect your first database](/getting-started/first-connection/) — what the
  wizard asks and why.

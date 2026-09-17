---
title: Three connections, and where the meta store lives
description: Introspection, data and Adminium's own tables each get their own handle, and the separation is enforced by the type system rather than by discipline.
---

## The situation

Adminium does three different things with databases, and they have nothing in
common except the word "database":

1. **Reads structure.** System catalogs, at connect time and on refresh. It
   needs broad catalog visibility and touches no rows.
2. **Reads and writes rows.** The CRUD path, widget data, exports. It needs
   exactly the tables the operator exposed.
3. **Stores its own state.** Pages, users, roles, settings, jobs, audit. This is
   Adminium's data, not the operator's.

Collapse those into one connection and two things go wrong at once: the
credential you hand over is more powerful than any single job needs, and
Adminium's own tables land in the middle of someone else's schema.

## The decision

Three logical connections, never interchangeable:

| Role | Lifetime | What it may do |
|---|---|---|
| **introspect** | short-lived, created per introspection | reads system catalogs only |
| **data** | a pooled handle, cached per connection id | the CRUD and widget-data path |
| **meta** | a separate handle, never given to an adapter | Adminium's own `adminium_*` tables |

**The separation is a type, not a convention.** The adapter interface is generic
over its role: `introspect()` is declared `this: DatabaseAdapter<'introspect'>`
while the row-reading methods are declared `this: DatabaseAdapter<'data'>`.
Calling one on the other does not compile, and every adapter re-checks its role
at runtime as well — because a wrong role is the kind of mistake that would
otherwise be found in production by a query that worked.

**The meta store is an operator's choice**, not a fourth hard-coded thing. It
can be a SQLite file, its own Postgres or MySQL database, or the same database
as the data connection. When it shares a database, the `adminium_*` prefix is
what keeps it identifiable; the code path is unchanged either way. The desktop
app is the one exception: its meta store must be SQLite, because there is no
server to point anywhere else.

## What it means for a contributor

- **Never pass a meta handle to an adapter.** The types will stop you; if you
  find yourself casting to get around it, the call belongs somewhere else.
- **A read of the operator's rows goes through the data role**, even when the
  answer is about structure. If you need catalog information during a request,
  read the stored snapshot instead of opening an introspection connection.
- **New `adminium_*` tables are a migration** in `@adminium/meta`, forward-only,
  and must work on all three engines. SQLite passes things Postgres and MySQL
  reject — column widths and foreign-key type mismatches especially — so a
  migration that has only run on SQLite has not been tested.

[How Adminium works](/anatomy/#3-the-running-process) shows how the three are
assembled at boot, and
[Read-only sources & the meta database](/guides/connect/read-only-and-meta/) is
the operator-facing version.

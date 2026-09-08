---
title: Editing your schema
description: Create, change and delete tables, columns and foreign keys from Studio — what Adminium will do, what it refuses, and why each refusal exists.
---

Adminium can change the structure of your database, not only read it. Studio →
**Schema** → **Design** creates tables, adds and alters columns, and creates real
foreign keys.

This page is the honest version: what it does, what it will not do, and why.

## The shape of a change

Nothing reaches your database until you have seen the statements.

1. **Design.** Edit the tables you want. This is a draft held in your browser.
2. **Review changes.** Adminium diffs your draft against the live schema and
   returns an ordered list of steps. Each carries a hazard, the reason for that
   hazard on *your* engine and *your* server version, what else in Adminium
   depends on it, and **the exact SQL that will run**.
3. **Apply.** A destructive change asks you to type the name of the thing being
   destroyed — the table's own name when you are dropping one — not a fixed
   word, so the confirmation makes you look at *what* is about to go.

The SQL in the review pane is not a rendering of the change — it is the
statement. The same function compiles it for the preview and executes it for
the apply, so the two cannot drift.

## What the hazard chips mean

| Chip | What it means |
|---|---|
| **Safe** | Metadata only. No rows are read or written. |
| **Holds a lock** | Other queries against this table may wait. Adminium sets a lock timeout so a change gives up rather than queueing your application behind it. |
| **Rewrites the table** | Every row is copied. Time and disk scale with the table. |
| **Discards data** | A column or its contents are destroyed. Requires Super Admin. |
| **Cannot be undone** | A table and every row in it are destroyed. Requires Super Admin. |
| **Refused** | Adminium will not do this — the step says why. |

The chip is computed per engine **and per server version**, because the same
statement is a different operation on different servers. Adding a `NOT NULL`
column with a default is metadata-only on PostgreSQL 11 and later and rewrites
the whole table on PostgreSQL 10. Adminium reads your server's version and tells
you which one you have.

## What it refuses, and why

- **A `NOT NULL` column with no default, on a table that already has rows.** The
  existing rows would have no value. Give the column a default, or make it
  nullable.
- **Adminium's own `adminium_*` tables**, and migration ledgers like
  `_prisma_migrations`. If you chose same-database meta storage, these sit
  beside your data — and they are not yours to edit through Adminium.
- **Views and materialized views.** Adminium models their columns, not their
  query, so it cannot recreate one faithfully.
- **A read-only connection**, one whose role lacks DDL privileges, one created
  from a schema file, and one set up for read-only analytics. The Design tab is
  absent rather than disabled, and the API answers `403 READ_ONLY_MODE`.
- **A table above the rewrite size ceiling.** Above roughly a million rows a
  rewrite is a maintenance-window operation, not a click.
- **A change to a table your database role does not own.** Adminium checks this
  per table before showing you a plan, so a permission problem arrives as a
  named refusal rather than as a failure halfway through.

## No undo

Adminium's record editor has an undo token. Schema changes have none, and
nothing here pretends otherwise: a dropped column's data is gone. The confirm
dialog says so, and the change history records exactly which statements ran.

## What happens on each engine

| | PostgreSQL | MySQL / MariaDB | SQLite |
|---|---|---|---|
| Roll back a failed apply | Yes | **No** — MySQL commits each DDL statement as it runs | Yes |
| Change a column's type | Usually without rewriting | Always copies the whole table | Rebuilds the table |
| Add a foreign key to an existing table | Yes | Yes | Rebuilds the table |
| Add a foreign key to a table you are creating | Part of the `CREATE` | Part of the `CREATE` | Part of the `CREATE` |

Because MySQL cannot roll back, an apply is **re-runnable** rather than
transactional: if it stops halfway, the change history shows which steps
succeeded and applying the same changes again completes them.

On SQLite, most changes that are not "add a column" are performed by rebuilding
the table — creating the new shape, copying every row, and restoring indexes and
triggers. Adminium verifies the result matches what it promised before
committing.

## What follows a change, and what does not

**Adminium re-reads your schema itself.** As soon as an apply succeeds it
re-introspects the connection, so the schema tree, the diagram and the next plan
all describe the database as it is now. You are never asked to tell Adminium
about a change it just made.

**A new table is offered a page.** Creating a table is not the same as adding it
to your app: a table with no page is invisible. So the summary after an apply
names the tables it created and offers to add them, which includes them in the
connection and regenerates the page set. The report says how many pages were
created, how many updated — and, importantly, **which pages were left alone
because somebody had edited them by hand**. Those are never overwritten, and
believing otherwise is how you wait for a change that will never arrive.

No role is granted access automatically. A newly generated page is reachable
only by Super Admins until you grant it in **Settings → Roles**.

If you **renamed** a table, Adminium repairs its own references in the same
operation: page bindings, saved-view tables, permission grants, schema
overrides, the included-tables list and the diagram layout all follow the new
name.

Four things deliberately do not:

- the **audit log**, which records what a table was called when the change
  happened,
- **import history**, for the same reason,
- **notification links** and **file attachments**, which are soft references,
- **saved-view filters** that name a renamed *column*.

The confirm dialog names these before you apply.

## Seeing the shape

Studio → **Schema** → **Diagram** draws the tables and their relations, and
distinguishes the three kinds of link:

- a **foreign key** your database enforces,
- an **inferred** relation Adminium guessed from a name or a join table, with
  its confidence,
- one **added in Adminium**, which is real to Adminium and invisible to every
  other tool pointed at the same database.

Double-click a table to open it in the designer. On a large schema the diagram
shows the most connected tables and says how many it is holding back; a list
view shows everything and works with a keyboard and a screen reader.

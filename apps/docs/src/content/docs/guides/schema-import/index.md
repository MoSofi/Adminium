---
title: Import a schema file
description: Build an admin app from a schema file with no live connection — pg_dump, Prisma, Drizzle, TypeORM, Sequelize, Rails, Django, or the JSON IR.
---

You do not need a reachable database to see what Adminium makes of your schema.
Hand it a schema **file** and it runs the same introspect → classify → generate
pipeline it would run over a live connection.

This matters when your database is behind a VPN you cannot open, when you are
evaluating before you hand over credentials, or when the schema exists in source
control before it exists in a server.

## Supported formats

| Format | Typical file | Guide |
|---|---|---|
| SQL DDL | `pg_dump -s`, `mysqldump --no-data`, `schema.sql` | [SQL DDL](/guides/schema-import/sql-ddl/) |
| Prisma | `schema.prisma` | [Prisma](/guides/schema-import/prisma/) |
| Drizzle | `schema.ts` | [Drizzle](/guides/schema-import/drizzle/) |
| TypeORM | entity files | [TypeORM](/guides/schema-import/typeorm/) |
| Sequelize | model files | [Sequelize](/guides/schema-import/sequelize/) |
| Rails | `db/schema.rb` | [Rails](/guides/schema-import/rails/) |
| Django | `models.py` | [Django](/guides/schema-import/django/) |
| JSON | Adminium's own IR | [JSON (the IR)](/guides/schema-import/json-ir/) |

Adminium detects the format from the file's content, not its extension. You can
override the detection if it guesses wrong.

## What you get, and what you do not

Every import produces the same **IR** (intermediate representation) a live
introspection produces, so the generated app is identical in shape. What differs
is what the source could tell you:

| | Live connection | Schema file |
|---|---|---|
| Tables, columns, types | Yes | Yes |
| Primary & foreign keys | Yes | Yes, if declared |
| Indexes, unique constraints | Yes | Usually |
| Enums | Yes | Yes |
| Comments / descriptions | Yes | Format-dependent |
| Row counts, cardinality | Yes | **No** |
| Actual data distribution | Yes | **No** |
| Capability probe (`canRead`/`canWrite`) | Yes | **No** |

The two "no"s have consequences worth knowing:

- **No row counts** means Adminium cannot use table size as a classification
  signal. A lookup table with 12 rows and a fact table with 40 million look the
  same to it, so some layout heuristics are less sharp than they would be live.
- **No capability probe** means the read-only/read-write question is unanswered
  until you attach a real connection.

An imported schema gets you a real, navigable app. Attaching the live connection
later refines it — the snapshot updates, your customizations survive.

## Importing

Through the Studio: **Connect → Import a schema file**, then drop the file in.

The schema-file path is a Studio and API flow. The
[`adminium introspect`](/reference/cli/#introspect) CLI command works over an
existing connection; it does not take a file.

## Type mapping

Every source type is mapped to an Adminium field type, and that mapping is where
imports get opinionated. The rules are shared across all formats:

| Source type family | Adminium field | Notes |
|---|---|---|
| `varchar`, `text`, `char` | text | Length becomes a validation hint |
| `int`, `bigint`, `smallint` | number | Integer-only input |
| `numeric`, `decimal` | number | Precision/scale preserved for display |
| `float`, `double`, `real` | number | |
| `bool`, `boolean` | boolean | MySQL `TINYINT(1)` included |
| `date` | date | |
| `timestamp`, `timestamptz`, `datetime` | timestamp | Timezone-aware where the source is |
| `time` | time | |
| `uuid` | uuid | Rendered monospace, not editable by default on PKs |
| `json`, `jsonb` | json | Structured editor |
| `enum`, `ENUM`, Postgres enum types | enum | Becomes a select input |
| `bytea`, `blob` | binary | Not rendered inline |
| `array` | array | Postgres only |
| Unrecognized | text | With a warning |

Unrecognized types import as text with a warning rather than failing the import.
You can override any field type afterwards; overrides survive re-introspection.

## Warnings are not errors

An import that emits warnings still produces an app. Common ones:

- **No primary key on `<table>`** — Adminium cannot uniquely address a row, so
  the table generates read-only. Add a PK or define one as an override.
- **Unrecognized type `<type>`** — imported as text.
- **Foreign key references an unknown table** — your file references a table
  that is not in it (a partial dump, or a cross-database FK). The relation is
  dropped.
- **Enum values could not be parsed** — the column imports as text.

Read them. They are the difference between "the app is wrong" and "the file did
not say".

## See also

- [The JSON IR](/guides/schema-import/json-ir/) — the format everything converts
  to, and a valid import format in its own right
- [Connect your first database](/getting-started/first-connection/) — when you
  do have a connection

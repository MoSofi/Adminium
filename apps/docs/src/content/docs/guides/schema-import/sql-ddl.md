---
title: Import SQL DDL
description: Import a pg_dump, mysqldump, or hand-written schema.sql. The highest-fidelity schema file format.
---

SQL DDL is the highest-fidelity import: it is what your database actually said,
not an ORM's description of it.

## Produce the file

```bash
# PostgreSQL — schema only, no rows
pg_dump --schema-only --no-owner --no-privileges mydb > schema.sql

# MySQL / MariaDB
mysqldump --no-data --skip-comments mydb > schema.sql

# SQLite
sqlite3 app.db .schema > schema.sql
```

`--schema-only` / `--no-data` matter. Adminium needs no rows, and a dump with
rows is a data leak waiting to happen.

## Detection

Adminium detects SQL DDL by the presence of `CREATE TABLE`. Dialect differences
(Postgres `serial`, MySQL `AUTO_INCREMENT`, SQLite affinity) are handled by the
type mapper.

## What is read

`CREATE TABLE`, column definitions and types, `PRIMARY KEY`, `FOREIGN KEY` /
`REFERENCES`, `UNIQUE`, `NOT NULL`, `DEFAULT`, `CHECK`, `CREATE INDEX`,
`CREATE TYPE … AS ENUM`, and `COMMENT ON` — which becomes a field description,
so a well-commented schema imports with documentation already attached.

## What is ignored

Views, functions, triggers, stored procedures, grants, extensions, and
`ALTER TABLE … OWNER TO`. None of them describe a table's shape, which is all
introspection is after.

`ALTER TABLE … ADD CONSTRAINT` **is** read — `pg_dump` emits foreign keys that
way, so ignoring it would drop every relationship in a Postgres dump.

## Notes

- **Order does not matter.** Forward references resolve after the whole file is
  parsed, so a dump that defines `orders` before `customers` is fine.
- **Partial dumps drop relations.** A foreign key pointing at a table not in the
  file produces a warning and the relation is dropped. Dump the whole schema.
- **Multiple schemas** are preserved; tables are qualified (`public.orders`).

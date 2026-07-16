---
title: Connect a PostgreSQL database
description: Connection strings, SSL, and a read-only role recipe for connecting Adminium to PostgreSQL.
---

## Connection string

```
postgres://user:password@host:5432/database?sslmode=require
```

`postgresql://` is accepted as a synonym. Percent-encode anything exotic in the
password (`@`, `/`, `:`).

| Parameter | Notes |
|---|---|
| `sslmode` | `require` for any database that is not on localhost. `disable`, `prefer`, `require`, `verify-ca`, `verify-full`. |
| `search_path` | Adminium introspects the schemas your role can see; it does not depend on `search_path` to find them. |

In the wizard you can paste a full DSN or fill host / port / user / password /
database and let Adminium compose it.

## A read-only role

Start here. You will see exactly what Adminium makes of your schema with no
possibility of a write.

```sql
CREATE ROLE adminium_ro LOGIN PASSWORD 'a-strong-password';

GRANT CONNECT ON DATABASE mydb TO adminium_ro;
GRANT USAGE ON SCHEMA public TO adminium_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO adminium_ro;

-- New tables should be readable too, without repeating the grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO adminium_ro;
```

On PostgreSQL 14+ the built-in role is shorter and covers every schema:

```sql
CREATE ROLE adminium_ro LOGIN PASSWORD 'a-strong-password';
GRANT pg_read_all_data TO adminium_ro;
```

The probe will report `read-only role`, and you get a read-only app with a
banner saying so.

:::caution[A read-only role forces a separate meta store]
Adminium must write its own `adminium_*` tables somewhere. A read-only role
cannot host them, so same-database placement is refused with
`META_PLACEMENT_INVALID`. This is enforced at connect time, not discovered at
first write. See [Read-only sources & the meta database](/guides/connect/read-only-and-meta/).
:::

## A read-write role

When you want Adminium to actually edit records:

```sql
CREATE ROLE adminium_rw LOGIN PASSWORD 'a-strong-password';

GRANT CONNECT ON DATABASE mydb TO adminium_rw;
GRANT USAGE ON SCHEMA public TO adminium_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO adminium_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO adminium_rw;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO adminium_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO adminium_rw;
```

Grant sequences too, or inserts into tables with `serial` / `identity` primary
keys will fail.

## Hosting the meta store in the same database

If — and only if — your role has DDL, Adminium can keep its own tables in a
dedicated schema of the same database:

```sql
CREATE SCHEMA adminium AUTHORIZATION adminium_rw;
```

Then point `ADMINIUM_META_URL` at that database. Adminium creates and migrates
its tables there. This keeps one database to back up; it also means an Adminium
migration touches the same server as your production data. For production, a
separate database is the safer answer:
[Where to put the meta store](/self-hosting/meta-store/).

## What the probe reports

```
Connected — 34 ms · PostgreSQL 16.2 · read-only role
```

- **`canRead`** — `SELECT` on at least one table in a visible schema.
- **`canWrite`** — `INSERT` / `UPDATE` / `DELETE`.
- **`canDDL`** — can create the meta schema, if you asked for same-database
  placement.

## What Adminium reads

Schema only, never rows: tables, columns and types, primary and foreign keys,
unique constraints, indexes, check constraints, enum types, comments, and
`information_schema` / `pg_catalog` metadata. Enums become select inputs,
foreign keys become navigable relations, and comments become field descriptions.

Rows are read only when you open a page that displays them — under your role,
subject to Adminium's own RBAC, and with PII masking on by default.

## Troubleshooting

**`no pg_hba.conf entry for host`** — PostgreSQL is refusing the connection
before authentication. Add a `pg_hba.conf` line for Adminium's source IP, or, on
a managed provider, add it to the trusted-sources list.

**`SSL connection required`** — add `?sslmode=require`.

**Connections to `localhost` are refused** — Adminium blocks loopback DSNs by
default, so a hosted instance cannot be talked into probing its own host. The
CLI wizard disables the guard for local setup, which is exactly when you *do*
mean `localhost`.

**No tables found** — your role can connect but has no `USAGE` on the schema, or
the tables live in a schema it cannot see. `GRANT USAGE ON SCHEMA`.

---
title: Connect a MySQL or MariaDB database
description: Connection strings, TLS, and a read-only user recipe for connecting Adminium to MySQL or MariaDB.
---

MySQL and MariaDB share one adapter. Where they differ, it is noted below.

## Connection string

```
mysql://user:password@host:3306/database
```

| Parameter | Notes |
|---|---|
| `ssl` / `sslmode` | Required by most managed providers (PlanetScale, RDS, Aiven). |
| Database name | Required. MySQL's "database" is what PostgreSQL calls a schema — Adminium introspects the one you name. |

Percent-encode anything exotic in the password.

## A read-only user

```sql
CREATE USER 'adminium_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON mydb.* TO 'adminium_ro'@'%';
FLUSH PRIVILEGES;
```

Narrow `'%'` to Adminium's actual source host if you can — `'adminium_ro'@'10.0.1.%'`.

The probe reports `read-only role`, and you get a read-only app with a banner
saying so.

:::caution[A read-only user forces a separate meta store]
Adminium must write its `adminium_*` tables somewhere, and a `SELECT`-only user
cannot host them. Same-database placement is refused with
`META_PLACEMENT_INVALID` at connect time. See
[Read-only sources & the meta database](/guides/connect/read-only-and-meta/).
:::

## A read-write user

```sql
CREATE USER 'adminium_rw'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE ON mydb.* TO 'adminium_rw'@'%';
FLUSH PRIVILEGES;
```

For same-database meta placement, the user also needs DDL on its own database:

```sql
CREATE DATABASE adminium_meta;
GRANT ALL PRIVILEGES ON adminium_meta.* TO 'adminium_rw'@'%';
FLUSH PRIVILEGES;
```

Then point `ADMINIUM_META_URL` at `mysql://adminium_rw:…@host:3306/adminium_meta`.

## What the probe reports

```
Connected — 41 ms · 8.0.36 · read-only role
```

MariaDB reports its own version string (`10.11.6-MariaDB`); Adminium adapts
introspection accordingly.

## What Adminium reads

Schema only: tables, columns and types, primary and foreign keys, unique
constraints, indexes, `ENUM` and `SET` definitions, `AUTO_INCREMENT` flags, and
column comments — all from `information_schema`. `ENUM` columns become select
inputs; foreign keys become navigable relations.

## MySQL-specific notes worth knowing

**Foreign keys need InnoDB.** MyISAM tables declare no foreign keys, so Adminium
sees no relationships to follow and generates flat tables instead of linked
detail pages. Check with:

```sql
SELECT table_name, engine FROM information_schema.tables
WHERE table_schema = 'mydb' AND engine <> 'InnoDB';
```

**`TINYINT(1)` is how MySQL spells boolean.** Adminium treats it as one, which is
right almost always — and wrong if you genuinely store 0–127 in a `TINYINT(1)`.
Override the field type if so.

**Zero dates.** `0000-00-00` is not a date any client can represent. If your
schema still allows them, expect nulls where those values are.

**Case sensitivity depends on the host filesystem.** `lower_case_table_names`
differs between a Linux server and a macOS one; a schema that introspects on one
may not on the other. This bites during migrations more than during
introspection.

## Troubleshooting

**`Access denied for user`** — the user exists but not for the host Adminium is
connecting from. MySQL identity is user *and* host: `'adminium_ro'@'localhost'`
and `'adminium_ro'@'%'` are different users.

**`Public Key Retrieval is not allowed`** — MySQL 8's `caching_sha2_password`
over a non-TLS connection. Enable TLS, or use `mysql_native_password` for this
user.

**No relationships in the generated app** — see the InnoDB note above.

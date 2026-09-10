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
| `options` | Passed through to the server. Adminium appends its own session settings after yours, so a `-c statement_timeout` you set here is overridden and anything else survives. A transaction pooler refuses `options` from either side — see [Pooled endpoints](#pooled-endpoints). |

In the wizard you can paste a full DSN or fill host / port / user / password /
database and let Adminium compose it.

### Pooled endpoints

Managed Postgres shows you a **pooled** connection string first — Neon's
`-pooler` host, Supabase's port `6543`, Fly's pgbouncer. Paste it. It works.

That is worth stating plainly because the mechanism underneath is not obvious.
Adminium sets `statement_timeout` on every connection it opens to your
database, plus `lock_timeout` and `idle_in_transaction_session_timeout` on the
introspection connection, so neither a slow query nor a lock wait can sit on
your database indefinitely. It sends them in the connection's startup packet, which costs no
extra round trip — and a transaction-pooling endpoint refuses startup
parameters outright:

```
08P01: unsupported startup parameter in options: statement_timeout
```

The first time a source hits that refusal, Adminium downgrades: it reopens the
pool without the startup parameters and re-sends the same statement with the
settings as a `SET LOCAL` prelude instead. The cost is one discarded
connection attempt per pool it opens — not one per query — and nothing
surfaces in the UI.

The limits still apply. `SET LOCAL` travels in the same protocol message as the
statement it guards, so Postgres scopes it to that statement's implicit
transaction: the budget is enforced on every catalog query, and it cannot leak
onto a backend the pooler later hands to somebody else.

#### The direct endpoint is still a little nicer

A preference now, not a requirement — with one concrete difference worth
knowing. Introspection keeps its full budget either way, through the prelude
above. **Reading rows does not.** That connection speaks Postgres' extended
query protocol, one statement per message, so there is nowhere to carry a
prelude — and every alternative would set the timeout on a backend the pooler
then hands to somebody else. So on a pooled endpoint your row queries run
without a server-side `statement_timeout`; on a direct one they get it.

Direct also saves a proxy hop on every query and the one discarded connection at
startup, and Adminium's own pooling already caps concurrent connections per
source (5 for introspection, 10 for data), so you give up little by not using
the provider's pooler. If your platform meters connections hard enough that the
pooler is the point, stay on it — nothing breaks.

| Provider | Pooled | Direct |
|---|---|---|
| Neon | host ends in `-pooler`, e.g. `ep-x-123456-pooler.us-east-1.aws.neon.tech` | the same host without `-pooler` — `ep-x-123456.us-east-1.aws.neon.tech`. The Neon console calls this the "Direct connection" string. |
| Supabase | the transaction pooler on port `6543` | the direct connection on port `5432`, or the session pooler, which accepts startup parameters and so never triggers the downgrade. |

The meta store has its own, separate answer to pooling — a pooled Postgres
endpoint is safe for the migration lock, and MySQL behind a transaction pooler
is not. See [Pooled endpoints](/self-hosting/meta-store/#pooled-endpoints).

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

**`unsupported startup parameter in options: statement_timeout`** — a
transaction-pooling endpoint refusing startup parameters. Adminium retries these
on its own (see [Pooled endpoints](#pooled-endpoints)), so reaching you means the
retry was refused too — most often because the DSN carries its own `options=`
parameter. Drop it, or use the direct endpoint.

**Connections to `localhost` are refused** — Adminium blocks loopback DSNs by
default, so a hosted instance cannot be talked into probing its own host. The
CLI wizard disables the guard for local setup, which is exactly when you *do*
mean `localhost`.

**No tables found** — your role can connect but has no `USAGE` on the schema, or
the tables live in a schema it cannot see. `GRANT USAGE ON SCHEMA`.

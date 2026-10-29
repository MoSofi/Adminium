---
title: Connect a PostgreSQL database
description: Connection strings, SSL, SSH tunnels, and read-only and least-privilege role recipes for connecting Adminium to PostgreSQL.
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
source (5 for introspection, 10 for data; `ADMINIUM_SOURCE_POOL_MAX` sets both —
see [Environment variables](/self-hosting/env-vars/)), so you give up little by not using
the provider's pooler. If your platform meters connections hard enough that the
pooler is the point, stay on it — nothing breaks.

| Provider | Pooled | Direct |
|---|---|---|
| Neon | host ends in `-pooler`, e.g. `ep-x-123456-pooler.us-east-1.aws.neon.tech` | the same host without `-pooler` — `ep-x-123456.us-east-1.aws.neon.tech`. The Neon console calls this the "Direct connection" string. |
| Supabase | the transaction pooler on port `6543` | the session pooler (port `5432` on the pooler host), which accepts startup parameters and so never triggers the downgrade; or the direct connection, which is IPv6-only unless you buy Supabase's IPv4 add-on. The shared pooler, in either mode, wants the user as `role.project-ref`: see [Supabase, step by step](#supabase-step-by-step). |

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

Neither form gets past [Row Level Security](#row-level-security-supabase-lovable):
`pg_read_all_data` grants `SELECT`, not the right to skip policies. On a
database whose tables have policies, read that section first.

:::caution[A read-only role forces a separate meta store]
Adminium must write its own `adminium_*` tables somewhere. A read-only role
cannot host them, so same-database placement is refused with
`META_PLACEMENT_INVALID`. This is enforced at connect time, not discovered at
first write. See [Read-only sources & the meta database](/guides/connect/read-only-and-meta/).
:::

## A read-write role

When you want Adminium to actually edit records. This role reads and writes
rows and can do nothing else — it cannot create, alter or drop a table — which
is the role to give Adminium on a production database:

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

`ALTER DEFAULT PRIVILEGES` covers only the tables created by the role that runs
it. If your migrations run as another role — an `app_owner` that owns the
schema — name it, or the tables your next migration creates will be invisible
to Adminium:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO adminium_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO adminium_rw;
```

### Writable where you grant it

Adminium reads the role's grants table by table, so you can hand it exactly
the tables it should change:

- **A table granted `SELECT` only** is read-only in Adminium: it lists and
  opens records, and offers no New, Edit or Delete.
- **A table granted by column** — `GRANT UPDATE (status, notes) ON orders TO
  adminium_rw` — can be edited in those columns; the form shows every other
  column read-only and never sends it. A column Adminium stamps on its own,
  such as an `updated_at`, is left alone when the role may not write it.
- A write the role may not make is refused with `READ_ONLY_MODE` before it
  reaches your database. A grant you change takes effect within a minute.

Before 0.3.5 Adminium treated any role that could not create a table as
read-only, so this recipe produced a read-only app; the workaround was
`GRANT CREATE ON DATABASE`. That grant is no longer needed — revoke it. A
connection added before 0.3.5 keeps the read-only flag its last test gave it:
press **Test** on the connection once after upgrading.

### Grants for an app's rules

An installed app's rules read and write more than the row being saved. A role granted table by
table or column by column needs these as well:

- **`UPDATE` on the columns a total writes.** A new ticket moves its order's total, the formulas
  that read that total and the balances beside it, and so on up the chain of
  [totals that climb](/reference/manifest/#totals-that-count-and-climb). A copy that follows its
  parent writes the child rows' columns too. Adminium checks these grants before the first
  statement and refuses the write with `403` `READ_ONLY_MODE`, naming `details.table` and
  `details.columns`, with `details.reason` `privileges`.
- **`SELECT` on the whole settings table.** A [limit](/guides/apps/booking-rules/#limits) that
  reads a number from the app's settings row reads that row as `SELECT *`. A grant on some of its
  columns only makes that read fail.
- **`SELECT` on the tables a limit counts from.** The rows a pool is held on (ticket types, room
  types, the rooms and their closures), and a slot limit's hours, closures and pauses, are read on
  every write the limit judges, by guests' availability, and by the desk's counts. The pool rows
  and the hours are read whole, so grant the whole table.

With the app's tables installed under its prefix, for example:

```sql
GRANT SELECT ON boxoffice_settings, boxoffice_ticket_types, boxoffice_events, boxoffice_halls TO adminium_rw;
GRANT UPDATE (total, ticket_count) ON boxoffice_orders TO adminium_rw;
```

## Row Level Security (Supabase, Lovable)

A table with Row Level Security turned on shows a role only the rows a policy
lets it see. Apps built on Supabase, Lovable's among them, turn it on for their
tables and write policies for the people who use the app (`anon`,
`authenticated`), never for a role you create for Adminium. So the recipes
above connect, and then:

- every list on such a table is **empty, with no error**: Postgres filters the
  rows rather than refusing the query;
- an edit changes **no row**, again with no error, and a new row is refused
  with `new row violates row-level security policy`.

Your app's policies protect your customers from each other. A back office
needs every row, so give Adminium's role the right to skip them:

```sql
ALTER ROLE adminium_rw BYPASSRLS;
```

Only a superuser, or a role that has `BYPASSRLS` itself, may give it. To see
whether the role you are signed in as can:

```sql
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

Where neither is true, a policy per table does the same for that table, and a
table added later needs its own:

```sql
CREATE POLICY adminium_all ON public.orders
  TO adminium_rw USING (true) WITH CHECK (true);
```

To see which of your tables have policies:

```sql
SELECT relname FROM pg_class
WHERE relrowsecurity AND relnamespace = 'public'::regnamespace;
```

### Tables in a schema the role cannot read

Supabase keeps its own tables in schemas of its own (`auth`, `storage`), and an
app's tables point at `auth.users`. A role made with the recipes above has no
right to those schemas. Adminium leaves out every schema the role may not use
and every table it may not read (the snapshot's warnings name them, as
`schemas-unusable` and `tables-unreadable`) and drops the keys that point at
them, so `orders.user_id` shows as the plain id.

Where you own the other schema (your own Postgres server), you can let the role
read just the columns it needs, and introspect again:

```sql
GRANT USAGE ON SCHEMA auth TO adminium_rw;
GRANT SELECT (id, email) ON auth.users TO adminium_rw;
```

**On hosted Supabase this grant does nothing.** The `auth` schema belongs to
`supabase_admin`, and the `postgres` role you are signed in as may use it but
not pass that on. Postgres skips the grant with a warning, and the SQL editor
still says "Success". To see what the role really has:

```sql
SELECT has_schema_privilege('adminium_rw', 'auth', 'USAGE');
```

So on Supabase, `user_id` columns stay plain ids. Most apps keep the customer's
name and email in their own tables anyway (Lovable's `orders` has
`customer_name` and `customer_email`), and those show as usual.

A read the database refuses anyway (a right taken away since the last
introspection) is answered with `403` `SOURCE_READ_REFUSED`, naming the schema
or table in `details.object`. A looked-up column it refuses comes back empty and
listed in the row's `_masked` marker, and the rest of the list still loads.

## Supabase, step by step

For an app built on Supabase, including one made with Lovable, Bolt or v0 on
your own Supabase project. Run the SQL in Supabase's **SQL Editor**.

1. **Make the role.** Use the [read-write recipe](#a-read-write-role) with
   `postgres` as the database name, then let it skip row security:

   ```sql
   ALTER ROLE adminium_rw BYPASSRLS;
   ```

   Supabase's `postgres` role has `BYPASSRLS` itself, so it may give it. Skip
   the `auth` grant above; it does nothing here.

2. **Copy the connection string.** Click **Connect** and take the **Session
   pooler** string. It looks like this:

   ```
   postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
   ```

   This shared pooler finds your project by the part after the dot in the user name.
   So keep it, and change only the role: `adminium_rw.abcdefghijklmnop`. With
   the role name alone, the login fails. Then put your role's password in place
   of `[YOUR-PASSWORD]`.

   The **Direct connection** string works too, without the project part
   (`adminium_rw@db.abcdefghijklmnop.supabase.co:5432`), but Supabase serves it
   over IPv6 unless you buy their IPv4 add-on, and many home and office
   networks can't reach it. The transaction pooler (port `6543`) works with the
   limits in [Pooled endpoints](#pooled-endpoints).

3. **Paste it into Adminium.** Adminium lists only your app's tables. It leaves
   out Supabase's own schemas (`auth`, `storage`, `realtime` and the rest) with
   a `schemas-unusable` warning, and keeps its own data (users, roles, pages)
   out of your database: the role cannot create tables, so same-database
   placement is not offered.

:::note[Lovable Cloud]
An app on Lovable's built-in backend (Lovable Cloud, an address ending in
`lovable.cloud`) does not live in your Supabase account, and Lovable's own docs
describe no connection string for it. Connect a Lovable app that uses your own
Supabase project.
:::

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
- **`canWrite`** — `INSERT`, `UPDATE` or `DELETE` on at least one table (or, on
  an empty database, the right to create one). The role is **read-only** when
  it has neither, when the server is a standby, or when its transactions are
  read-only by default (`default_transaction_read_only`).
- **`canDDL`** — can create the meta schema, if you asked for same-database
  placement.

## Through an SSH tunnel

A database that listens only on its own server's loopback — the safe default
for a Postgres on a single VPS — is reachable over SSH without opening its
port. On the machine that runs Adminium:

```bash
ssh -N -L 15432:127.0.0.1:5432 deploy@db.example.com
```

and connect Adminium to the tunnel's end:

```
postgres://adminium_rw:a-strong-password@127.0.0.1:15432/mydb
```

`sslmode` can stay off: the tunnel is the encryption. To keep the tunnel up
across dropped connections, add `-o ServerAliveInterval=30
-o ExitOnForwardFailure=yes` and run it under `autossh` or a service manager.

**A key that can only tunnel.** On the database server, the key's line in
`~deploy/.ssh/authorized_keys` can forbid everything but this one forward:

```
restrict,port-forwarding,permitopen="127.0.0.1:5432" ssh-ed25519 AAAA… adminium-tunnel
```

A shell, a command, or a forward anywhere else is refused.

### Why the npm CLI allows `127.0.0.1` and the Docker image does not

Adminium refuses a source on a loopback address — `localhost`, `127.0.0.0/8`,
`::1` — when it runs with `NODE_ENV=production`, so that a hosted instance
cannot be pointed at services on its own host. The Docker image sets
`NODE_ENV=production`; `npx @adminiumjs/adminium` does not. So:

- **The npm CLI** (`npx @adminiumjs/adminium`, on your own machine) connects to the tunnel
  at `127.0.0.1:15432` as above.
- **The Docker image** refuses `127.0.0.1`, and inside a container it would be
  the container's own loopback anyway. Point it at the host instead. On Docker
  Desktop, use `host.docker.internal:15432`. On Linux, start the container with
  `--add-host=host.docker.internal:host-gateway` and bind the tunnel to the
  bridge address the container reaches the host on, for example
  `ssh -N -L 172.17.0.1:15432:127.0.0.1:5432 deploy@db.example.com`.
  Never bind it to `0.0.0.0`: that publishes your database to the network.

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

**`Loopback hosts are not allowed in production`** — Adminium is running with
`NODE_ENV=production` (the Docker image does) and the DSN names `localhost` or
`127.0.0.1`, so that a hosted instance cannot be talked into probing its own
host. See [Through an SSH tunnel](#through-an-ssh-tunnel) for the address to use
instead.

**Every record is read-only, or one table is** — the role lacks the grant. The
probe reports `read-only role` when it can write no table at all; a single
read-only table is one granted `SELECT` only. See
[Writable where you grant it](#writable-where-you-grant-it).

**No tables found** — your role can connect but has no `USAGE` on the schema, or
the tables live in a schema it cannot see. `GRANT USAGE ON SCHEMA`.

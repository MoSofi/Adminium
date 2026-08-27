---
title: Docker Compose
description: The shipped docker-compose.yml — services, the with-meta profile, volumes, healthchecks, and the variables it reads.
sidebar:
  order: 2
---

The repository ships a `docker-compose.yml` that runs Adminium, optionally with
a PostgreSQL 16 meta store. This page documents that file as it is.

## Minimal

```bash
ADMINIUM_SECRET=$(openssl rand -hex 32) docker compose up
```

→ `http://localhost:4600` → the first-run wizard.

That gets you Adminium with an **embedded SQLite meta store** in the
`adminium-data` volume. It announces itself at boot. Fine to try; see
[Where to put the meta store](/self-hosting/meta-store/) before you rely on it.

:::danger[`ADMINIUM_SECRET` must be stable across restarts]
The compose file marks it **required** and fails fast if unset, rather than
defaulting it — a defaulted encryption key is worse than none, because it looks
like security.

It derives the AES-256-GCM key for every stored DSN and API key, and signs the
session cookie. Change it and every stored secret becomes
undecryptable. Put it in `.env`, back it up where you back up passwords, and do
not rotate it casually.
:::

## With a Postgres meta store

```bash title=".env"
ADMINIUM_SECRET=a-32-byte-hex-string-from-openssl
ADMINIUM_META_URL=postgres://adminium:adminium@meta-db:5432/adminium
```

```bash
docker compose --profile with-meta up -d
```

The `meta-db` service is gated behind the `with-meta` profile — without the flag
it does not exist, so plain `docker compose up` stays a one-service deployment
for people bringing their own meta store.

**Setting the profile does not set `ADMINIUM_META_URL`.** They are two
independent facts: the profile starts a database, the variable tells Adminium to
use it. Start the profile without the variable and you get a Postgres container
sitting idle while Adminium writes to embedded SQLite — no error, just two
things not talking. Set both.

Change the meta database's credentials with `META_DB_USER`, `META_DB_PASSWORD`,
and `META_DB_NAME` — and keep `ADMINIUM_META_URL` in agreement, since nothing
derives one from the other.

## Variables the compose file reads

| Variable | Default | Purpose |
|---|---|---|
| `ADMINIUM_SECRET` | **required — fails fast** | Derives every encryption key |
| `ADMINIUM_VERSION` | `latest` | Image tag. Pin it in production. |
| `ADMINIUM_META_URL` | *(unset)* | Meta DSN. Unset → embedded SQLite in the volume. |
| `ADMINIUM_SOURCE_URL` | *(unset)* | Your own database. Connected and generated on the first boot. |
| `META_DB_USER` | `adminium` | `with-meta` Postgres user |
| `META_DB_PASSWORD` | `adminium` | `with-meta` Postgres password |
| `META_DB_NAME` | `adminium` | `with-meta` Postgres database |

`ADMINIUM_DATA_DIR` is set to `/data` in the compose file to match the volume
mount; it is also the image default.

Adminium reads more variables than the compose file passes through — logging,
proxy trust, CORS, telemetry. Add them to the `environment:` block as needed:
[Environment variables](/self-hosting/env-vars/).

:::note[Your source database is `ADMINIUM_SOURCE_URL`]
Set it and the first boot connects that database, introspects it, and generates
the pages; leave it unset and you connect it in the first-run wizard. It runs
once, and a DSN that does not work leaves the connection in `error` without
stopping the boot — details in
[Environment variables](/self-hosting/env-vars/#adminium_source_url).

Earlier builds passed a `DATABASE_URL` through this file, described as exactly
this. No code ever read it, so a container that set it got silence. The name was
not reused: a container still setting it now gets a line on stderr telling it
what to rename.
:::

## Volumes

| Volume | Mounted at | Holds |
|---|---|---|
| `adminium-data` | `/data` | Files, exports, backups, and the embedded SQLite meta store |
| `meta-db-data` | `/var/lib/postgresql/data` | The `with-meta` Postgres store |

Both are **named** volumes, so the instance survives `docker compose down` and
image upgrades. `docker compose down -v` deletes them and everything in them.

If you use the embedded meta store, `adminium-data` **is your database**. Back it
up accordingly, or move to a real meta store.

## Healthchecks

There are two probes, and they answer different questions. Pick the one that
matches what you are asking.

| | Route | Asks | Fails when |
|---|---|---|---|
| **Liveness** | `/api/v1/healthz` | Is the process up and serving? | The process is wedged or gone |
| **Readiness** | `/api/v1/readyz` | Can it serve a real request? | The meta store is unreachable (503) |

Adminium's **container healthcheck is the liveness probe**: it runs
`GET /api/v1/healthz` and asserts `ok: true` in the parsed JSON body — not
merely a 200.

Assert the parsed body if you write your own. Bare `/healthz` has no route, so
the SPA history fallback answers it with `index.html` and HTTP 200: a probe
there passes as long as the static files are on disk, whether or not the API is
running.

:::caution[Liveness does not check your meta store]
`/api/v1/healthz` returns `{ok: true}` unconditionally. If your Postgres dies
after Adminium has booted, the container stays **healthy** and keeps answering —
while every request 500s.

That is intentional: the healthcheck drives `restart: unless-stopped`, and
restarting Adminium cannot reconnect a dead database — it would only convert a
brief outage into a crash-loop. **If you route traffic based on health — a load
balancer, an orchestrator's readiness gate — point it at `/api/v1/readyz`**,
which runs a `SELECT 1` against the meta store and answers 503 when it fails.
:::

```
interval: 30s · timeout: 5s · retries: 3 · start_period: 40s
```

`start_period` is generous because the first boot applies the meta migrations
before it starts listening.

The `meta-db` service uses `pg_isready`.

## No `depends_on`, deliberately

The `adminium` service does **not** declare `depends_on: [meta-db]`. A dependency
on a profiled service breaks plain `docker compose up` for everyone not using the
profile.

`restart: unless-stopped` covers the startup race instead: if Postgres is not
accepting connections yet, Adminium exits and Docker restarts it until it is. A
few restarts in the first thirty seconds of a fresh `--profile with-meta up` are
expected, not a fault.

## The meta database is not published to the host

`meta-db` uses `expose`, not `ports` — it is reachable on the compose network
and nowhere else. That is correct: it holds Adminium's private state and nothing
outside the compose network has business connecting to it.

If you need a psql session against it, go through Docker rather than opening a
port:

```bash
docker compose exec meta-db psql -U adminium -d adminium
```

## Your source database is not here

There is deliberately no source-DB service in the compose file. You point
Adminium at the database you already have, in the first-run wizard. Adminium
connects **out** to your infrastructure.

## Operating it

```bash
# Logs
docker compose logs -f adminium

# CLI subcommands, same services as the server
docker compose exec adminium adminium migrate --status
docker compose exec adminium adminium export-zip --out /data/backup.zip

# Upgrade
ADMINIUM_VERSION=0.5.1 docker compose up -d
```

Migrations apply automatically on boot. Read
[Upgrading](/self-hosting/upgrades/) before a version jump — especially the part
about backing up first, because meta migrations are forward-only.

## Next

- [Behind a reverse proxy](/self-hosting/reverse-proxy/) — TLS, and the
  `ADMINIUM_TRUST_PROXY` you will need
- [Security hardening](/self-hosting/security/)
- [Where to put the meta store](/self-hosting/meta-store/)

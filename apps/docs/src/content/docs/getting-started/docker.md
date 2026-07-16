---
title: Run with Docker
description: Run Adminium as a container. A single docker run for a quick look, or Docker Compose with the with-meta profile for a real deployment.
sidebar:
  order: 3
---

The Adminium image is multi-stage, runs as the **non-root** `node` user on
`node:22-slim`, ships for `linux/amd64` and `linux/arm64`, and uses `dumb-init`
as PID 1 so `docker stop` reaches Fastify as a real `SIGTERM`.

Nothing about the container changes the application. Its `CMD` is
`adminium start` — the same CLI command `npx adminium` exposes. One code path,
two front doors.

## The fastest look

```bash
docker run --rm -p 4600:4600 \
  -e ADMINIUM_SECRET=$(openssl rand -hex 32) \
  -v adminium-data:/data \
  ghcr.io/adminium/adminium:latest
```

Open `http://localhost:4600` and create the first super admin.

:::caution[This is a look, not a deployment]
With no `ADMINIUM_META_URL`, Adminium falls back to an **embedded SQLite meta
store** under `/data` and says so at boot. That fallback is legitimate — it is
what makes the command above work — but it ties your instance to that one
volume. For anything you intend to keep, give it a real meta store: see
[Docker Compose](/self-hosting/docker-compose/).
:::

Pin a version rather than `latest` for anything real:

```bash
docker run --rm -p 4600:4600 ghcr.io/adminium/adminium:0.5.0
```

## Compose

```bash
ADMINIUM_SECRET=$(openssl rand -hex 32) docker compose up
```

Compose refuses to start without `ADMINIUM_SECRET` — the file marks it required
rather than defaulting it, because a defaulted encryption key is worse than no
key at all. Put it in a `.env` file next to the compose file:

```bash title=".env"
ADMINIUM_SECRET=replace-me-with-openssl-rand-hex-32
```

To get a PostgreSQL 16 meta store alongside Adminium, enable the `with-meta`
profile and point Adminium at it:

```bash title=".env"
ADMINIUM_SECRET=replace-me-with-openssl-rand-hex-32
ADMINIUM_META_URL=postgres://adminium:adminium@meta-db:5432/adminium
```

```bash
docker compose --profile with-meta up -d
```

Full walkthrough — volumes, healthchecks, the startup race, and the variables
the compose file reads: [Docker Compose](/self-hosting/docker-compose/).

## What the container expects

| | |
|---|---|
| **Port** | `4600`. `HOST` defaults to `0.0.0.0` in the image, which is what you want in a container. |
| **Data directory** | `/data`. `ADMINIUM_DATA_DIR=/data` is baked into the image and declared as a `VOLUME`. Mount something there. |
| **Required env** | `ADMINIUM_SECRET`. It is **not** baked into the image; the image ships only code. |
| **Healthcheck** | `GET /api/v1/healthz`, asserting `ok: true` in the JSON body |
| **User** | `node`, uid 1000. No root at runtime. |

Every variable: [Environment variables](/self-hosting/env-vars/).

:::note[The health route is `/api/v1/healthz`, not `/healthz`]
If you write your own probe — a load balancer, a Kubernetes readiness check —
use `/api/v1/healthz` and check the body, not just the status.

Bare `/healthz` has no route. It is answered by the SPA history fallback with
`index.html` and HTTP 200, so a probe pointed there passes as long as the static
files exist on disk — including for an instance whose meta store is unreachable.
It would report healthy while being useless.
:::

## Your source database is not in the compose file

Deliberately. The `with-meta` profile provisions Adminium's *own* store —
`adminium_*` tables, users, page config. **Your** database is yours: it lives on
your infrastructure, and Adminium connects out to it.

If your source database runs on the Docker host rather than in the compose
network, remember the container's `localhost` is not the host's:

```bash
# Linux
--add-host=host.docker.internal:host-gateway
# then connect to postgres://user:pass@host.docker.internal:5432/mydb
```

## Running CLI commands against a container

The image symlinks `adminium` onto `PATH`, so every
[CLI](/reference/cli/) subcommand works inside it, against the same meta store
and through the same services as the running server:

```bash
docker compose exec adminium adminium migrate --status
docker compose exec adminium adminium introspect --connection <id>
docker compose exec adminium adminium export-zip --out /data/backup.zip
```

Write anything you want to keep to `/data` — it is the mounted volume. Anything
else lives in the container's writable layer and dies with it.

## Next

- [Docker Compose](/self-hosting/docker-compose/) — the real deployment
- [Behind a reverse proxy](/self-hosting/reverse-proxy/) — TLS and `ADMINIUM_TRUST_PROXY`
- [Upgrading](/self-hosting/upgrades/) — pulling a new tag safely

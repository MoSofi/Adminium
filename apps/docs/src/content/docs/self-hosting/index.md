---
title: Self-hosting Adminium
description: Requirements, the deployment shapes, and the decisions worth making before you put Adminium in front of a team.
sidebar:
  order: 1
---

Adminium is a single Node process. No Redis, no external queue, no external
scheduler, no sidecar. Fastify serves the API, the WebSocket, and the dashboard
build; the engine runs in-process; jobs run on an in-process loop backed by the
`adminium_jobs` table.

That is the whole architecture. It fits on one small VPS.

## Requirements

| | |
|---|---|
| **Node.js** | 22 or newer (if running from a source checkout) |
| **Port** | 4600 by default |
| **Meta store** | PostgreSQL, MySQL/MariaDB, or SQLite |
| **Source database** | PostgreSQL, MySQL/MariaDB, or SQLite — external, always |
| **Memory** | A few hundred MB idle; scales with concurrent users, not with your database's size |

## Pick a shape

| | Use when |
|---|---|
| [From source](/getting-started/quickstart/) | A laptop, an evaluation, a machine you already manage with Node |
| [Docker](/getting-started/docker/) | You would rather not manage a Node install |
| [Docker Compose](/self-hosting/docker-compose/) | A real deployment, with a meta database |

All three run the identical process. Only the wrapper differs.

## Decide these before you commit

### 1. Where the meta store lives

The single most consequential choice, and the one that is annoying to change
later. Adminium's own tables — users, roles, connections, snapshots, page
config, audit — have to live somewhere, and the default (embedded SQLite) is an
evaluation default, not a production one.

→ [Where to put the meta store](/self-hosting/meta-store/)

### 2. `ADMINIUM_SECRET`, and where you keep it

Required. It derives the AES-256-GCM key for every stored DSN and API key, the
session HMAC key, and the CSRF key.

```bash
export ADMINIUM_SECRET=$(openssl rand -hex 32)
```

Lose it and every stored connection string and provider key becomes
undecryptable — they must be re-entered. Rotate it and the same thing happens.
Treat it exactly as you treat a database password: in a secret manager, backed
up, not in the shell history, not in the image.

→ [Security hardening](/self-hosting/security/)

### 3. What role Adminium connects with

Adminium is as powerful against your database as the role you give it, and no
more. Start read-only. Grant writes to the tables you actually want editable —
per table, not wholesale.

→ [Read-only sources & the meta database](/guides/connect/read-only-and-meta/)

### 4. Whether it is behind TLS

It should be. Adminium does not terminate TLS — put Caddy or nginx in front, and
set `ADMINIUM_TRUST_PROXY=on` so it reads `X-Forwarded-For` correctly.

→ [Behind a reverse proxy](/self-hosting/reverse-proxy/)

## Health and readiness

```
GET /api/v1/healthz
```

Returns JSON with `ok`. **Check the body, not just the status code.** Bare
`/healthz` has no route — the SPA history fallback answers it with `index.html`
and a 200, so a probe there reports healthy for an instance whose meta store is
unreachable.

## Backups

Two things to back up, and they are not the same thing:

| | What | How |
|---|---|---|
| **The meta store** | Users, roles, connections, page config, audit | Your database's normal backup |
| **The data directory** | Files, exports — and the embedded meta store, if you use it | Filesystem backup of `ADMINIUM_DATA_DIR` |
| **`ADMINIUM_SECRET`** | The key to everything encrypted in the meta store | Your secret manager |

A meta-store backup without the secret is unreadable. Back them up together, and
test the restore.

`adminium export-zip` is **not** a backup — it is a config bundle, and it is not
a substitute for a database backup. See
[Export & restore](/self-hosting/export-zip/).

## Telemetry is off

Adminium sends nothing anywhere unless you turn it on. There is no default-on
analytics, no license check, no phone-home.

→ [Telemetry](/self-hosting/telemetry/)

## Next

- [Environment variables](/self-hosting/env-vars/) — the complete list
- [Upgrading](/self-hosting/upgrades/) — forward-only migrations, and the
  downgrade guard
- [Security hardening](/self-hosting/security/)

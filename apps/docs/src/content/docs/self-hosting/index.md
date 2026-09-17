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
| **Node.js** | 22.14 or newer (for `npx` or a source checkout; the Docker image brings its own) |
| **Port** | 4600 by default |
| **Meta store** | PostgreSQL, MySQL/MariaDB, or SQLite |
| **Source database** | PostgreSQL, MySQL/MariaDB, or SQLite — external, always |
| **Memory** | A few hundred MB idle; scales with concurrent users, not with your database's size |

## Pick a shape

| | Use when |
|---|---|
| [The npm package](/getting-started/quickstart/) | A laptop, an evaluation, a machine you already manage with Node |
| [A project](/projects/deploy/) | Somebody writes code for this admin: pages, hooks or actions you deploy from a repository |
| [Docker](/getting-started/docker/) | You would rather not manage a Node install |
| [Docker Compose](/self-hosting/docker-compose/) | A real deployment, with a meta database |
| [A VPS without Docker](/self-hosting/vps/) | A real deployment on a Linux server you manage, as a systemd service |

All five run the identical process. Only the wrapper differs — a project image
is the published image with the project folder copied into it.

## Decide these before you commit

### 1. Where the meta store lives

The single most consequential choice, and the one that is annoying to change
later. Adminium's own tables — users, roles, connections, snapshots, page
config, audit — have to live somewhere, and the default (embedded SQLite) is an
evaluation default, not a production one.

→ [Where to put the meta store](/self-hosting/meta-store/)

### 2. `ADMINIUM_SECRET`, and where you keep it

Required. It derives the AES-256-GCM key for every stored DSN and API key, and
signs the session cookie.

```bash
export ADMINIUM_SECRET=${ADMINIUM_SECRET:-$(openssl rand -hex 32)}
```

The `${VAR:-…}` form matters: a bare `$(openssl rand -hex 32)` mints a *new*
secret every time the line runs, so re-running this block in the same shell
would silently orphan the setup you already had. Copy the generated value
somewhere durable before you close the terminal.

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

Three things to back up, and they are not the same thing:

| | What | How |
|---|---|---|
| **The meta store** | Users, roles, connections, page config, audit | Your database's normal backup |
| **The data directory** | Files stored on this server's disk, exports, installed apps and add-ons — and the embedded meta store and its pre-upgrade snapshots, if you use it | Filesystem backup of `ADMINIUM_DATA_DIR` |
| **`ADMINIUM_SECRET`** | The key to everything encrypted in the meta store | Your secret manager |

A meta-store backup without the secret is unreadable. Back them up together, and
test the restore.

On a host with no persistent disk, such as DigitalOcean App Platform, the data
directory is empty again after every deploy, so there is nothing there to back
up. Keep the meta store in a managed database and files in a
[storage destination](/self-hosting/env-vars/#adminium_storage_url), and know
that installed apps and some add-ons are lost at each deploy — see
[Installing apps](/self-hosting/installing-apps/#on-a-host-with-no-persistent-disk)
and [Installing add-ons](/self-hosting/installing-add-ons/#on-a-host-with-no-persistent-disk).
With a PostgreSQL or MySQL meta store, Adminium writes no backup of its own:
back up that database with its own tools.

`adminium export-zip` is **not** a backup — it is a config bundle, and it is not
a substitute for a database backup. See
[Export & restore](/self-hosting/export-zip/).

### What a backup does not cover

With no storage destination configured, every file is on this server's own disk
under `ADMINIUM_DATA_DIR/files`, and the data-directory row above covers it.
Once you set `ADMINIUM_STORAGE_URL` — or add a destination in Studio — every
*new* upload, record attachment, export artifact, branding logo and imported
schema file goes to that bucket or that server instead (what was already written
stays where it is until you move it), and **a filesystem backup of the data
directory will not contain them.** Neither will the desktop app's
[backup archive](/desktop/backups/), which carries the meta store, your local
SQLite databases and a redacted copy of the desktop config — and no file bytes
at all, wherever they are stored.

Those bytes are the bucket's or the server's own responsibility: object
versioning, lifecycle rules, snapshots, whatever that storage already gives you.
Adminium does not copy them anywhere on your behalf and does not pretend to.

What survives either way is the *record* of them. Every file's row in the meta
store carries its name, size, SHA-256, which destination it lives on and which
record it is attached to, so a restore can say exactly what is missing rather
than losing the reference along with the bytes.

## Telemetry is off

Adminium sends nothing anywhere unless you turn it on. There is no default-on
analytics, no license check, no phone-home.

→ [Telemetry](/self-hosting/telemetry/)

## Next

- [Environment variables](/self-hosting/env-vars/) — the complete list
- [Upgrading](/self-hosting/upgrades/) — forward-only migrations, and the
  downgrade guard
- [Security hardening](/self-hosting/security/)

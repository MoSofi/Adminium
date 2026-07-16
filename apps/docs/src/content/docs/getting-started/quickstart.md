---
title: Quickstart with npx
description: Install and run Adminium with one command. Generate a secret, run npx adminium, answer the setup wizard, and get an admin panel on your own schema.
sidebar:
  order: 2
---

The published `adminium` package bundles the server, the dashboard build, and
the meta migrations. One `npx adminium` is a complete install — there is nothing
else to clone, build, or wire together.

## Requirements

- **Node.js 22 or newer** (`node -v`).
- A database you can reach, or a schema file. Neither is required to *start* —
  the wizard will ask.

## 1. Set a secret

`ADMINIUM_SECRET` is **required**. It derives the key that encrypts every stored
DSN and API key at rest, so Adminium refuses to start without it and prints a
fail-fast table telling you so.

```bash
export ADMINIUM_SECRET=$(openssl rand -hex 32)
```

:::danger[Keep this value]
Store it exactly as you would a database password. If you lose it, every stored
connection string and provider key becomes undecryptable and must be re-entered.
If you rotate it, do the same. It must be **at least 16 characters**.
:::

## 2. Run the wizard

```bash
npx adminium
```

Run with no command and Adminium starts the interactive setup wizard. It walks
you through:

1. **Meta placement** — where Adminium's own `adminium_*` tables live. Press
   Enter to accept the embedded SQLite store under your data directory; it will
   tell you it did. See [Where to put the meta store](/self-hosting/meta-store/).
2. **Source** — the engine (PostgreSQL, MySQL, or SQLite) and either a full DSN
   or host/port/user/password/database fields.
3. **Test** — a live probe reporting latency, server version, and whether your
   role is read-only.
4. **Tables** — which tables to include. Blank or `all` takes everything;
   otherwise a comma-separated list.
5. **Intent** — full admin, read-only analytics, CRUD, or support console. This
   shapes what gets generated.

Then it introspects, generates, and starts the server:

```
Adminium is running at http://0.0.0.0:4600
```

Open it, create the first super admin, and you have an admin panel.

:::note[The wizard needs a TTY]
`adminium` with no arguments refuses to run non-interactively — there is nothing
useful it could do with unanswerable questions. In CI, containers, and
`systemd`, configure through the environment and run
[`adminium start`](/reference/cli/#start) instead.
:::

## 3. Subsequent starts

Once configured, skip the wizard:

```bash
adminium start
```

`start` applies any pending meta migrations, then boots. Useful flags:

```bash
adminium start --port 8080 --host 127.0.0.1
adminium start --log-level debug
```

Full flag list: [CLI reference](/reference/cli/#start).

## Non-interactive install

For a scripted or containerized install, set the environment instead of
answering questions:

```bash
export ADMINIUM_SECRET=$(openssl rand -hex 32)
export ADMINIUM_META_URL='postgres://adminium:secret@meta-db:5432/adminium_meta'
export ADMINIUM_DATA_DIR=/var/lib/adminium
export PORT=4600

adminium migrate   # apply meta migrations (idempotent)
adminium start
```

Connections are then added through the Studio UI or the REST API rather than the
wizard. Every environment variable:
[Environment variables](/self-hosting/env-vars/).

## Where things are stored

| What | Where | Override |
|---|---|---|
| Adminium's own tables | The meta store | `ADMINIUM_META_URL`, or `--meta-url` |
| Files, exports, the embedded SQLite meta store | `./data` | `ADMINIUM_DATA_DIR`, or `--data-dir` |
| The encrypted meta DSN, when you ask the wizard to remember it | `<data-dir>/adminium.json` | — |

The meta DSN cannot live inside the meta store it points at, so when the wizard
offers to remember your choice it writes it to `adminium.json`,
AES-256-GCM-encrypted under `ADMINIUM_SECRET`.

## Next

- [Connect your first database](/getting-started/first-connection/)
- [Run with Docker](/getting-started/docker/) instead
- [Self-hosting overview](/self-hosting/) — before you put this in front of a team

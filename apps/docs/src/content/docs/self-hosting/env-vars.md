---
title: Environment variables
description: Every environment variable Adminium reads, its default, and what happens when it is wrong.
sidebar:
  order: 3
---

Adminium validates its environment **before it starts**. On invalid input it
prints a `variable | problem | hint` table to stderr and exits — it does not boot
half-configured and fail later.

## The complete list

| Variable | Required | Default | Description |
|---|---|---|---|
| `ADMINIUM_SECRET` | **Yes** | — | Derives the key encrypting stored DSNs and API keys. **Minimum 16 characters.** |
| `PORT` | No | `4600` | Listen port. Integer 1–65535. |
| `HOST` | No | `0.0.0.0` | Bind address. `127.0.0.1` to bind loopback only. |
| `ADMINIUM_META_URL` | No | *(embedded SQLite)* | Meta-store DSN: `postgres://`, `mysql://`, or `sqlite:<path>`. |
| `ADMINIUM_DATA_DIR` | No | `./data` | Writable directory for files, exports, backups, and the embedded meta store. |
| `DATABASE_URL` | No | — | **First-boot seed only** — see below. |
| `ADMINIUM_LOG_LEVEL` | No | `info` | `fatal` · `error` · `warn` · `info` · `debug` · `trace` |
| `ADMINIUM_TELEMETRY` | No | *(unset)* | Overrides the consent screen's answer. Unset = let it stand; telemetry is opt-in either way. |
| `ADMINIUM_NETWORK_FEATURES` | No | `on` | `off` on air-gapped installs — the UI stops offering webhooks, OAuth, and provider-API AI. |
| `ADMINIUM_TRUST_PROXY` | No | `off` | `on` when behind a reverse proxy. |
| `ADMINIUM_CORS_ORIGINS` | No | *(off)* | CSV of exact origins for split deployments. **No wildcard.** |
| `ADMINIUM_BRIDGE_ORIGINS` | No | *(off)* | CSV of exact origins allowed to hand this instance a connection string. **No wildcard.** |
| `ADMINIUM_DISABLE_UPDATES` | No | *(unset)* | **Desktop app only.** `1` forces the update mode to `disabled` — see below. |

An empty string is treated as unset, so `FOO= adminium start` behaves like
`FOO` being absent.

## `ADMINIUM_SECRET`

The only required variable, and the one worth understanding.

```bash
export ADMINIUM_SECRET=$(openssl rand -hex 32)
```

It derives — via a KDF, it is not used directly — the AES-256-GCM key that
encrypts every stored DSN and provider API key at rest, plus the session and
CSRF keys.

:::danger[It must be stable, and it must be kept]
**Lose it** and every stored connection string and provider key is
undecryptable. They must be re-entered by hand.

**Change it** and the same thing happens — this is not a rotation you can
perform casually.

**Share it** and anyone with a copy of your meta store can decrypt everything in
it.

Store it in a secret manager. Back it up alongside — and separately from — your
meta store.
:::

Under 16 characters and Adminium refuses to start:

```
Adminium failed to start — invalid environment configuration:

| variable        | problem                        | hint                                                        |
|-----------------|--------------------------------|-------------------------------------------------------------|
| ADMINIUM_SECRET | must be at least 16 characters | set a random string of at least 16 characters, e.g. `openssl rand -hex 32` |
```

## `ADMINIUM_META_URL`

Where Adminium's own `adminium_*` tables live.

```bash
ADMINIUM_META_URL='postgres://adminium:pass@meta-host:5432/adminium_meta'
ADMINIUM_META_URL='mysql://adminium:pass@meta-host:3306/adminium_meta'
ADMINIUM_META_URL='sqlite:/var/lib/adminium/meta.db'
```

Unset, Adminium falls back to an embedded SQLite store under
`ADMINIUM_DATA_DIR` and **says so at boot**. That warning is not noise — it is
there so the fallback can never be your production meta store by accident.

The meta store's engine is independent of your source database's.

→ [Where to put the meta store](/self-hosting/meta-store/)

## `DATABASE_URL`

:::caution[A seed, not configuration]
If set, `DATABASE_URL` is imported as the first source connection on the **first
boot only**, then ignored.

It is not "the database Adminium uses". Changing it later does nothing.
Removing it does not remove the connection. It exists so a container can boot
with a connection already present; after that, connections are managed in Studio
or through the API.
:::

## `ADMINIUM_TRUST_PROXY`

Off by default, which is right for a direct-to-internet or localhost process:
without a proxy in front, `X-Forwarded-For` is attacker-controlled and trusting
it would let anyone forge their source IP in your audit log and rate limits.

Turn it **on** when — and only when — a reverse proxy you control is in front.

```bash
ADMINIUM_TRUST_PROXY=on
```

→ [Behind a reverse proxy](/self-hosting/reverse-proxy/)

## `ADMINIUM_CORS_ORIGINS`

Off by default. The dashboard is served by the same process as the API, so it is
same-origin and needs no CORS at all.

Set it only for a split deployment where the dashboard is served from a
different origin:

```bash
ADMINIUM_CORS_ORIGINS='https://admin.acme.io,https://ops.acme.io'
```

Exact origins, comma-separated. **`*` is rejected** — responses are
credentialed (they carry cookies), and a wildcard origin with credentials is
either a browser error or a vulnerability, depending on the browser.

## `ADMINIUM_BRIDGE_ORIGINS`

Off by default, and unrelated to `ADMINIUM_CORS_ORIGINS` above.

A web page cannot open a TCP connection to PostgreSQL, so when you paste a
connection string on [adminium.dev/generate](https://adminium.dev/generate/)
that page has nowhere to send it. This setting lets your browser hand the string
to an Adminium running on your own machine instead. It goes browser →
`localhost`; adminium.dev is a static site with no server to receive it.

`adminium --bridge` sets this for you, to `https://adminium.dev` and nothing
else. Set the variable directly only if you run your own copy of that page:

```bash
ADMINIUM_BRIDGE_ORIGINS='https://adminium.dev'
```

Unset, the bridge routes are **not registered at all** — there is no endpoint to
probe, rather than one that refuses. When it is set, three gates apply:

1. **Origin.** Only the listed origins may call it, and the JSON content type
   forces a preflight, so a page that is not on the list cannot deliver a
   request at all. `*` is rejected.
2. **Pairing code.** The instance prints an 8-character code at startup and the
   hand-off requires it. It is regenerated on every restart and never written to
   disk or the logs — the terminal is the only place it appears.
3. **Session.** The route that gives the connection string *back* is
   same-origin, cookie-authenticated and `connections:manage`-gated. A guessed
   ticket is worthless without an admin session.

The bridge never connects to anything. It parks a string for a few minutes and
the Studio wizard uses it to **pre-fill the connect form**, which you still
review and submit yourself.

## `ADMINIUM_TELEMETRY`

Accepts `on`, `true`, `1` (and `off`, `false`, `0`).

This variable is an **override**, not the switch. Telemetry's normal control is
the first-run consent screen (`telemetry.enabled`), and it is off by default.

- **Unset** (the default) — the consent answer stands. This is what you want on
  a normal install.
- **Set** — the environment wins outright, in both directions. `off` is a hard
  veto that a user clicking "yes" in the wizard cannot lift; `on` reports
  without waiting to be asked.

It does not govern the update check, which has its own consent
(`updates.checkEnabled`, also off by default).

→ [Telemetry](/self-hosting/telemetry/)

## `ADMINIUM_NETWORK_FEATURES`

Accepts `on`, `true`, `1` (and `off`, `false`, `0`). Default `on`.

This is a **policy** answer, not a connectivity check. Adminium never probes the
internet to find out whether it is reachable — that outbound call is exactly what
an air-gapped install is promised it will not make. So the server reports what
you told it, and the UI adapts.

Set it `off` on an install with no outbound network. Features that need the
internet — webhooks, OAuth integrations, provider-API AI enrichment — then say so
up front instead of being discovered one timeout at a time. Nothing is hidden:
each surface explains why it is unavailable.

Everything Adminium does locally is unaffected: browsing and editing data, charts,
generation, exports, scheduled reports, and the copy/paste AI round-trip all work
exactly the same.

```bash
ADMINIUM_NETWORK_FEATURES=off
ADMINIUM_TELEMETRY=off
```

Together with `ADMINIUM_TELEMETRY=off` and `updates.checkEnabled` left at its
default, that is a complete no-phone-home configuration.

## `ADMINIUM_DISABLE_UPDATES`

Read by the **desktop app**, not the server: a kill-switch for fleet admins who
manage machines running the Electron build.

Set to exactly `1`, it forces the desktop update mode to `disabled` regardless
of what the desktop config says. Disabled means the updater is **never
initialized** — the update library is not even loaded, and no update-related
network request is made. Any other value (including `0`) leaves the configured
mode in effect; only the literal `1` disables, so a typo cannot silently turn
updates *on* or *off* the wrong way.

## Flags override the environment

Where a CLI flag exists, it wins:

```bash
PORT=4600 adminium start --port 8080   # listens on 8080
```

| Flag | Variable |
|---|---|
| `--port` | `PORT` |
| `--host` | `HOST` |
| `--meta-url` | `ADMINIUM_META_URL` |
| `--data-dir` | `ADMINIUM_DATA_DIR` |
| `--log-level` | `ADMINIUM_LOG_LEVEL` |

→ [CLI reference](/reference/cli/)

## Not an environment variable: the bootstrap file

When the setup wizard offers to remember your meta DSN, it writes
`<data-dir>/adminium.json` — the meta DSN cannot live inside the meta store it
points at. The value is AES-256-GCM-encrypted under `ADMINIUM_SECRET`.

`ADMINIUM_META_URL` takes precedence over it.

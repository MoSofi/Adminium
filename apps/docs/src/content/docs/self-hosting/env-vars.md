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
| `ADMINIUM_SOURCE_URL` | No | *(unset)* | Your own database — connected, introspected, and generated on the first boot. See below. |
| `ADMINIUM_DATA_DIR` | No | `./data` | Writable directory for files, exports, backups, add-on packages, and the embedded meta store. |
| `ADMINIUM_LOG_LEVEL` | No | `info` | `fatal` · `error` · `warn` · `info` · `debug` · `trace` |
| `ADMINIUM_STATIC_ROOT` | No | *(auto-detected)* | Serve the dashboard build from this directory instead of the auto-detected copy. |
| `ADMINIUM_TELEMETRY` | No | *(unset)* | Overrides the consent screen's answer. Unset = let it stand; telemetry is opt-in either way. |
| `ADMINIUM_NETWORK_FEATURES` | No | `on` | `off` on air-gapped installs — the UI stops offering webhooks, OAuth, and provider-API AI. |
| `ADMINIUM_TRUST_PROXY` | No | `off` | `on` when behind a reverse proxy. |
| `ADMINIUM_CORS_ORIGINS` | No | *(off)* | CSV of exact origins for split deployments. **No wildcard.** |
| `ADMINIUM_BRIDGE_ORIGINS` | No | *(off)* | CSV of exact origins allowed to hand this instance a connection string. **No wildcard.** |
| `ADMINIUM_PUBLIC_API_ORIGINS` | No | *(off)* | CSV of exact origins allowed to reach the scoped public API — plus the sentinel `self` for pages Adminium hosts itself. Unset means those routes are not registered at all. **No wildcard.** Must not overlap `ADMINIUM_CORS_ORIGINS`. |
| `ADMINIUM_RUNTIME` | No | `self-host` | `self-host` · `desktop`. **Set by the Electron shell only** — see below. |
| `ADMINIUM_BOOT_TOKEN` | No | *(unset)* | 64 hex characters. **Desktop shell only** — see below. |
| `ADMINIUM_DESKTOP_SINGLE_USER` | No | *(unset)* | **Desktop shell only.** Mirrors the app's "skip login on this computer" answer. |
| `ADMINIUM_DEMO_SEED_SCRIPT` | No | *(unset)* | **Desktop shell only.** Absolute path to the demo-database seed script. |
| `ADMINIUM_DISABLE_UPDATES` | No | *(unset)* | **Desktop app only.** `1` forces the update mode to `disabled` — see below. |

An empty string is treated as unset, so `FOO= adminium start` behaves like
`FOO` being absent.

Anything not on this list is ignored. Adminium validates exactly these — a
misspelled variable does not fail the boot, it simply does nothing, which is why
the list is worth checking against.

## `ADMINIUM_SECRET`

The only required variable, and the one worth understanding.

```bash
export ADMINIUM_SECRET=$(openssl rand -hex 32)
```

It derives — via a KDF, it is not used directly — the AES-256-GCM key that
encrypts every stored DSN and provider API key at rest, and it signs the session
cookie.

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

:::note[The other database]
`ADMINIUM_META_URL` is where Adminium keeps its **own** state. The database you
want an admin panel **for** is a different thing, and it has its own variable —
`ADMINIUM_SOURCE_URL`, below.
:::

## `ADMINIUM_SOURCE_URL`

The database the back office is generated **from**. Set it and the first boot
connects it, introspects the schema, and generates the pages, so a container
comes up with a working dashboard instead of an empty one:

```yaml
ADMINIUM_SOURCE_URL: postgres://app:secret@db:5432/app
```

Leave it unset and nothing changes: you connect your database in the first-run
wizard, which is how every non-Docker install starts. Either way you still finish
setup in the browser — this seeds the connection, never the super admin.

**It runs once.** After one successful connection the seed is claimed and never
runs again, so a connection you delete later stays deleted rather than
reappearing on the next `docker compose up`. An instance that already has
connections ignores the variable entirely and says so in the boot log.

**A DSN that does not work does not stop the boot.** The server starts, the
connection is recorded with the driver's own error where Studio shows it, and the
next boot tries again with whatever the variable says then — so a typo is fixed
where you wrote it, not in the database. That retry is the reason the failure is
not claimed: a stored DSN cannot be edited through the API, only replaced.

:::caution[It is not `DATABASE_URL`]
Earlier builds accepted a `DATABASE_URL` and described it here as exactly this
feature. Nothing ever read it, so setting it did nothing at all. The name did not
come back with the feature — an unrecognised variable is ignored rather than
rejected, and a name with that history is worth not reusing. A container still
setting it gets a line on stderr at boot telling it what to rename.
:::

## `ADMINIUM_STATIC_ROOT`

The directory the dashboard build is served from — the one holding the build's
`index.html`. Unset, Adminium finds it automatically: the copy bundled into the
published package, else `apps/dashboard/dist` in a monorepo checkout. That is
right for every normal install, so most deployments never set this.

Set it when the automatic pick is wrong — a dashboard built to a custom
location, or a development checkout where a stale bundled copy is shadowing a
fresh build:

```bash
ADMINIUM_STATIC_ROOT=/srv/adminium/dashboard adminium start
```

If the directory has no `index.html`, Adminium logs a warning naming the path,
then falls back to the automatic candidates (or serves the API alone) rather
than refusing to boot.

## `ADMINIUM_TRUST_PROXY`

Off by default, which is right for a direct-to-internet or localhost process:
without a proxy in front, `X-Forwarded-For` is attacker-controlled and trusting
it would let anyone forge their source IP in your audit log and rate limits.

Turn it **on** when — and only when — a reverse proxy you control is in front.

```bash
ADMINIUM_TRUST_PROXY=on
```

→ [Behind a reverse proxy](/self-hosting/reverse-proxy/)

## `ADMINIUM_PUBLIC_API_ORIGINS`

Turns on the **public API** — a scoped, read-mostly surface at `/api/v1/public` that your own
customer-facing or staff-facing pages can call from a browser. It is off by default and stays off
until you name the origins allowed to use it.

```bash
ADMINIUM_PUBLIC_API_ORIGINS='https://shop.example.com'
```

**`self` is the one value that is not an origin.** It admits the pages this instance serves
*itself* — hosted app surfaces at `/apps/…`, and any domain you attach to one of them. A same-origin
page cannot appear in a cross-origin allow-list (its requests carry no `Origin` header at all), so
without the sentinel a customer surface Adminium hosts could never call its own API. An instance
whose only public consumers are its own hosted surfaces needs exactly this and nothing more:

```bash
ADMINIUM_PUBLIC_API_ORIGINS='self'
```

Combine it with real origins (`self,https://shop.example.com`) when standalone pages call in from
elsewhere too.

Three things about it are deliberate, and each one has bitten somebody:

- **Unset means the routes do not exist.** Not "exist and refuse" — there is nothing there to probe.
- **It must not overlap `ADMINIUM_CORS_ORIGINS`.** That list is for your admin dashboard and its
  responses carry credentials; this one never does. An origin in both would make Adminium send two
  conflicting `Access-Control-Allow-Origin` headers and the browser would reject the response. The
  server refuses to start rather than let you find that out from a CORS error naming neither
  variable.
- **It needs `ADMINIUM_TRUST_PROXY=1` unless you bind to `127.0.0.1`.** Behind a reverse proxy
  without it, every anonymous visitor looks like the same IP address, so they all share one
  rate-limit bucket and a single scraper can lock out your real customers while the limiter appears
  to be working. Adminium refuses to register the public API in that combination and logs why.

Naming an origin here is still not enough on its own: the public API also has a runtime switch
(**Settings → Public API**) that is off until you turn it on, and every key you issue is limited to
one scope you define. Turning the switch back off is instant and destroys nothing — keys, scopes and
data all survive.

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

## The desktop block

`ADMINIUM_RUNTIME`, `ADMINIUM_BOOT_TOKEN`, `ADMINIUM_DESKTOP_SINGLE_USER` and
`ADMINIUM_DEMO_SEED_SCRIPT` are set by the **Electron app** when it launches its
own server process. They are listed here because Adminium validates them, not
because a self-host deployment should set them.

`ADMINIUM_RUNTIME` is the one to understand, because it decides what the server
*exposes*. Under `desktop` — and only under `desktop` — the server registers
`POST /api/v1/auth/desktop-session`, the route that trades the desktop app's
per-launch boot token for a session without a password. It exists so the app can
open straight into your data on a machine you already unlocked.

On a self-host or Docker install the runtime is `self-host`, that route is
**never registered**, and the password-free door does not exist to be attacked —
which is a stronger guarantee than a check inside a handler. Setting
`ADMINIUM_RUNTIME=desktop` on a server would create it. Do not.

The other three are inert without it: the boot token is minted fresh per launch
and never stored, the single-user flag mirrors a choice made in the desktop app's
own settings, and the seed-script path points at a file that ships inside the app
bundle.

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
| `--static-root` | `ADMINIUM_STATIC_ROOT` |

→ [CLI reference](/reference/cli/)

## Not an environment variable: the bootstrap file

When the setup wizard offers to remember your meta DSN, it writes
`<data-dir>/adminium.json` — the meta DSN cannot live inside the meta store it
points at. The value is AES-256-GCM-encrypted under `ADMINIUM_SECRET`.

`ADMINIUM_META_URL` takes precedence over it.

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
| `ADMINIUM_SECRET` | **Yes** | the data folder's `secret` file, if `adminium try` made one | Derives the key encrypting stored DSNs and API keys. **Minimum 16 characters.** |
| `PORT` | No | `4600` | Listen port. Integer 1–65535. |
| `HOST` | No | `0.0.0.0` | Bind address. `127.0.0.1` to bind loopback only. |
| `ADMINIUM_META_URL` | No | *(embedded SQLite)* | Meta-store DSN: `postgres://`, `mysql://`, or `sqlite:<path>`. |
| `ADMINIUM_META_POOL_MAX` | No | `10` (trial mode: `3`) | How many connections a Postgres or MySQL meta store's pool may open. Integer 1–100. See below. |
| `ADMINIUM_ARCHIVE_KEY` | No | *(a key made from `ADMINIUM_SECRET`)* | Signs and checks instance archives (`adminium archive`). At least 32 characters. Set it, the same on every server, to restore an archive into an instance with another secret. See [Back up and move an instance](/self-hosting/archive/). |
| `ADMINIUM_SOURCE_POOL_MAX` | No | *(per pool: 10, schema reads 5; trial mode: 3)* | How many connections each pool opened against a source database may hold. Integer 1–100; at most 3 in trial mode. See below. |
| `ADMINIUM_RATE_LIMIT_SCALE` | No | `1` | **Test servers only.** Multiplies every request limit. Integer 1–1000. Ignored when `NODE_ENV` is `production`. See below. |
| `ADMINIUM_SOURCE_URL` | No | *(unset)* | Your own database — connected, introspected, and generated on the first boot. See below. |
| `ADMINIUM_SETUP_TOKEN` | In trial mode | *(derived from `ADMINIUM_SECRET`, printed at boot)* | The one-time token the first-run wizard asks for before it creates the first account. **Minimum 16 characters**, not counting spaces and dashes. See below. |
| `ADMINIUM_DATA_DIR` | No | `./data`, or `~/.adminium` | Writable directory for files, exports, backups, installed apps and add-ons, and the embedded meta store. Put it on a persistent disk: a host that empties it on every deploy loses installed apps and add-ons, whatever else is configured. Docker and the desktop app set it for you. A CLI run that does not: `./data` when the working directory is a project (it holds a `package.json`, a `.git`, a `Dockerfile`, a `go.mod`…) or already holds an Adminium instance, and `~/.adminium` otherwise — so `npx @adminiumjs/adminium try` from a home directory leaves nothing behind in it. A service should always set it, since its working directory decides the default. |
| `ADMINIUM_STORAGE_URL` | No | *(this server's disk)* | Where uploaded and generated files live. Seeded once, on a boot with no storage destination configured. See below. |
| `AWS_ENDPOINT_URL_S3` | No | *(unset)* | S3-compatible endpoint. Read **only** by the first-boot storage seed, and only when `ADMINIUM_STORAGE_URL` is unset. See below. |
| `AWS_REGION` | No | `auto` | Region for the AWS storage variables. |
| `BUCKET_NAME` | No | *(unset)* | Bucket for the AWS storage variables. |
| `AWS_ACCESS_KEY_ID` | No | *(unset)* | Access key for the AWS storage variables. |
| `AWS_SECRET_ACCESS_KEY` | No | *(unset)* | Secret key for the AWS storage variables. |
| `ADMINIUM_BUNDLED_ADD_ONS` | No | `./add-ons-bundle` | Directory of pre-verified add-on tarballs seeded into the store at boot — see [Installing add-ons](/self-hosting/installing-add-ons/). |
| `ADMINIUM_BUNDLED_APPS` | No | `./apps-bundle` | Directory of pre-verified app tarballs seeded at boot, so *Studio → Hosted apps* has apps to install without reaching the network. See below. |
| `ADMINIUM_LOG_LEVEL` | No | `info` | `fatal` · `error` · `warn` · `info` · `debug` · `trace` |
| `ADMINIUM_STATIC_ROOT` | No | *(auto-detected)* | Serve the dashboard build from this directory instead of the auto-detected copy. |
| `ADMINIUM_SURFACES_DIR` | No | *(unset)* | Directory of built app surfaces, served at `/apps/<app>/<side>/`. Unset means this instance hosts no apps. See below. |
| `ADMINIUM_CSP_IMG_HOSTS` | No | *(unset)* | CSV of extra origins pictures may load from — for app data that links images hosted elsewhere. Named hosts only: **no bare `*`**, no scheme on its own. See below. |
| `ADMINIUM_DATABASE_HOSTS` | In trial and hosted mode | *(unset)* | CSV of `host[:port]` database hosts a production server may reach on its own loopback, such as `localhost:5432` for a Postgres on the same server. Source databases only. See below. |
| `ADMINIUM_LOCAL_DATABASES` | No | `setting` | `setting` lets a super admin switch on *Allow databases on this server* in Studio's Server settings, for any database on this server's own loopback; `off` locks that switch off, so only `ADMINIUM_DATABASE_HOSTS` counts. See below. |
| `ADMINIUM_SQLITE_DIRS` | No | *(unset)* | CSV of absolute folders a SQLite source database must lie in, such as `/srv/databases`. Unset means any file the server can open, except Adminium's own. See below. |
| `ADMINIUM_STORAGE_DIRS` | No | *(unset)* | CSV of absolute folders a `local` storage destination must lie in, such as `/srv/files`. Unset means any folder, except Adminium's own. See below. |
| `ADMINIUM_NETWORK_POLICY` | No | `open` | `strict` also refuses the server's own network (private ranges) for source databases, webhooks and storage endpoints, and this machine and its network for add-ons' network calls. A source host in `ADMINIUM_DATABASE_HOSTS` still passes. See below. |
| `ADMINIUM_MAP_SERVER` | No | `https://tiles.openfreemap.org` | Where maps' pictures come from: one `https://` origin, or `off` for no maps on this install. See below. |
| `ADMINIUM_ROUTING_SERVER` | No | `https://router.project-osrm.org` | The OSRM server asked for routes along roads, once that is switched on in Settings → Maps; or `off`. See below. |
| `ADMINIUM_TELEMETRY` | No | *(unset)* | Overrides the consent screen's answer. Unset = let it stand; telemetry is opt-in either way. |
| `ADMINIUM_NETWORK_FEATURES` | No | `on` | `off` on air-gapped installs — the UI stops offering webhooks, OAuth, and provider-API AI, and the server asks adminium.dev for no list of add-ons or apps. |
| `ADMINIUM_DEPLOY_LINK` | No | `on` | `off` hides **Put this online…**, a link to [adminium.dev/deploy](https://adminium.dev/deploy) in the user menu, on Studio's Export everything page and on About (and in the desktop app's Help menu). For an operator who offers their own hosting or rebrands. Only a link: nothing is fetched. |
| `ADMINIUM_SUPABASE_CONNECT_URL` | No | *(unset)* | The `https://` address of an operator's connect service. Set, the connect wizards show **Connect Supabase** above the connection-string form, and the instance redeems a one-time code at `<address>/redeem`. **https only**, or the boot fails. Unset, nothing changes. See [Running Adminium for other people](/self-hosting/for-other-people/#8-connect-supabase). |
| `ADMINIUM_TRIAL_MODE` | No | `off` | `on` runs a trial for someone else on your server: connections only to your host list, no code of their own, no outgoing calls of their choosing (mail goes through your relay), banners and size caps. Needs `ADMINIUM_TRIAL_ENDS_AT`, `ADMINIUM_SETUP_TOKEN`, `ADMINIUM_PUBLIC_ORIGIN` and `ADMINIUM_DATABASE_HOSTS`, or the boot fails. See [Trial mode and the hosted profile](#trial-mode-and-the-hosted-profile). |
| `ADMINIUM_TRIAL_ENDS_AT` | In trial mode | — | When the trial ends: a date and time **with its zone**, `2026-12-01T00:00:00Z`. |
| `ADMINIUM_PUBLIC_ORIGIN` | In trial and hosted mode | *(unset)* | Your address for this instance, `https://shop.example.com`. One origin; `http://` only for this machine. Set on any server, the instance answers only on this host and `ADMINIUM_OPERATOR_DOMAINS` (any other `Host` gets 421), and links in email point here. See [Your addresses for the instance](#your-addresses-for-the-instance). |
| `ADMINIUM_TRIAL_DATA_MAX_MB` | No | `500` | Trial mode: megabytes of live data per database on one of your hosts. |
| `ADMINIUM_TRIAL_UPLOAD_MAX_MB` | No | `10` | Trial mode: megabytes per uploaded file. |
| `ADMINIUM_TRIAL_STORAGE_MAX_MB` | No | `1000` | Trial mode: megabytes for the whole data folder. |
| `ADMINIUM_TRIAL_UPGRADE_URL` | No | *(unset)* | Trial mode: the `https://` address of your Upgrade page; `?instance=` is added. Unset, no Upgrade button. |
| `ADMINIUM_TRIAL_SMTP_URL` | No | *(unset)* | Trial mode: your mail relay for this instance, `smtp://user:password@relay:587`. A secret: takes `_FILE`. |
| `ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY` | No | `50` | Trial mode: user emails a day through the relay (and 20 an hour). |
| `ADMINIUM_TRIAL_MAIL_FROM` | With `ADMINIUM_TRIAL_SMTP_URL` | — | Trial mode: the address your relay pins for this instance, `i-7f3a9c@relay.example.com`. Every mail goes from it. See [Email in trial mode](#email-in-trial-mode). |
| `ADMINIUM_TRIAL_MAIL_REPORT_URL` | No | `mailto:abuse@` the From address's domain | Trial mode: where a recipient reports a mail, `https://…` or `mailto:…`; linked in the footer of every user-written mail. |
| `ADMINIUM_OPERATOR_NAME` | No | the From address's domain | Your name as mail from the relay says it: `"<instance> via <your name>"`. At most 60 characters, no `@ < > " \ , ; : ( ) [ ]`. |
| `ADMINIUM_HOSTED_MODE` | No | `off` | `on` runs a paid installation on your server: the trial's host list, network policy, own-code and address rules stay; the clock, banners and caps go. Needs `ADMINIUM_PUBLIC_ORIGIN` and `ADMINIUM_DATABASE_HOSTS`. |
| `ADMINIUM_OPERATOR_DOMAINS` | No | *(unset)* | CSV of the user's own verified domains: plain lower-case host names, `shop.example.com`. No wildcard, address, port or path. Honoured with or without trial mode: the instance answers on these and `ADMINIUM_PUBLIC_ORIGIN`'s host, links in email point at `https://` and the first one, and only these can be mapped to an app's side or the add-on pages. |
| `ADMINIUM_OPERATOR_TOKEN` | No | *(unset)* | The [operator endpoint](/self-hosting/operator-endpoint/)'s bearer token, and the key [instance events](#adminium_operator_events_url) are signed with: 32 random bytes or more (`openssl rand -hex 32`), one per instance. Needs `ADMINIUM_OPERATOR_LISTEN`, `ADMINIUM_OPERATOR_EVENTS_URL` or both. A secret: takes `_FILE`. |
| `ADMINIUM_OPERATOR_LISTEN` | No | *(unset)* | `address:port` the [operator endpoint](/self-hosting/operator-endpoint/) listens on, on your own network: `10.0.0.2:4601`. Never `0.0.0.0`, a name, or `PORT`. Needs `ADMINIUM_OPERATOR_TOKEN`. The public listener never serves `/api/v1/operator/*`. |
| `ADMINIUM_OPERATOR_EVENTS_URL` | No | *(unset)* | Where [signed instance events](#adminium_operator_events_url) go: `https://…`, or `http://` to a private address. Needs `ADMINIUM_OPERATOR_TOKEN`. |
| `ADMINIUM_AI_OPERATOR_ONLY` | No | `off` | `on`: AI runs on your connection unless the user adds their own key to Anthropic, OpenAI or Google. |
| `ADMINIUM_AI_OPERATOR_SCOPE` | No | *(unset)* | `dashboard`: AI on your connection builds dashboards only. |
| `ADMINIUM_AI_OPERATOR_BUDGET_TOKENS` | No | *(unset)* | Tokens AI on your connection may spend over the instance's life. |
| `ADMINIUM_DESIGNER_START_PROMPT_B64` | No | *(unset)* | The Designer's first prompt after setup, as base64; at most 2,000 characters decoded. |
| `ADMINIUM_DESIGNER_START_PROMPT_FILE` | No | *(unset)* | The same prompt from a read-only file: an absolute path. Not both. |
| `ADMINIUM_DESIGNER` | No | `off` | `live` lets a Super Admin switch [Adminium Designer](/projects/designer/#on-a-server-people-reach) on for this server, in Settings → AI. Anything else, and its routes do not exist. `adminium design` needs no variable. |
| `ADMINIUM_AI_ANTHROPIC_API_KEY` | No | — | An Anthropic key: a model connection the server has without anything saved in Settings → AI. See [the `ADMINIUM_AI_*` block](#the-adminium_ai_-block). |
| `ADMINIUM_AI_OPENAI_API_KEY` | No | — | An OpenAI key, the same way. |
| `ADMINIUM_AI_COMPATIBLE_BASE_URL` | No | — | The address of an OpenAI-compatible server (`http://localhost:8000/v1`). |
| `ADMINIUM_AI_COMPATIBLE_API_KEY` | No | — | The key for that server, when it wants one. |
| `ADMINIUM_AI_OLLAMA_BASE_URL` | No | — | The address of Ollama (`http://localhost:11434`). |
| `ADMINIUM_AI_GOOGLE_API_KEY` | No | — | A Google AI Studio key, used only to [make pictures with Gemini](/projects/designer/#make-a-picture-with-ai) in the Designer. It is no chat connection. |
| `ADMINIUM_AI_MODEL` | No | — | The model in use, as `<provider>/<model>`: `anthropic/claude-sonnet-5-5`, `ollama/qwen3`. |
| `ADMINIUM_TRUST_PROXY` | No | `off` | `on` when behind a reverse proxy. |
| `ADMINIUM_TRUSTED_PROXIES` | No | `loopback,uniquelocal` | Which connections count as your proxy while `ADMINIUM_TRUST_PROXY` is on. See below. |
| `ADMINIUM_CORS_ORIGINS` | No | *(off)* | CSV of exact origins for split deployments. **No wildcard.** |
| `ADMINIUM_BRIDGE_ORIGINS` | No | *(off)* | CSV of exact origins allowed to hand this instance a connection string. **No wildcard.** |
| `ADMINIUM_PUBLIC_API_ORIGINS` | No | *(off)* | CSV of exact origins allowed to reach the scoped public API — plus the sentinel `self` for pages Adminium hosts itself. Unset means those routes are not registered at all, except under `adminium dev`, where it defaults to `self`. **No wildcard.** Must not overlap `ADMINIUM_CORS_ORIGINS`. |
| `ADMINIUM_RUNTIME` | No | `self-host` | `self-host` · `desktop`. **Set by the Electron shell only** — see below. |
| `ADMINIUM_BOOT_TOKEN` | No | *(unset)* | 64 hex characters. **Desktop shell only** — see below. |
| `ADMINIUM_DESKTOP_SINGLE_USER` | No | *(unset)* | **Desktop shell only.** Mirrors the app's "skip login on this computer" answer. |
| `ADMINIUM_DEMO_SEED_SCRIPT` | No | *(unset)* | **Desktop shell only.** Absolute path to the demo-database seed script. |
| `ADMINIUM_DISABLE_UPDATES` | No | *(unset)* | **Desktop app only.** `1` forces the update mode to `disabled` — see below. |

An empty string is treated as unset, so `FOO= adminium start` behaves like
`FOO` being absent.

One variable is deliberately not in this list: **`ADMINIUM_PROJECT_DIR`**. It
names the [project](/projects/) folder a command should use, and it is read
*before* the project's `.env` is loaded — that is, before the table above is
validated at all. It is documented with the commands that read it:
[CLI reference](/reference/cli/#environment).

Anything not on this list is ignored. Adminium validates exactly these — a
misspelled variable does not fail the boot, it simply does nothing, which is why
the list is worth checking against.

## `ADMINIUM_SECRET`

The only required variable, and the one worth understanding.

```bash
export ADMINIUM_SECRET=$(openssl rand -hex 32)
```

With none set, a CLI command reads the one `adminium try` kept in the data
folder's `secret` file, if there is one (`try` makes it for a new folder). On a
server, set the variable: a key kept beside the data it unlocks protects nothing
from someone who can read the folder.

It derives — via a KDF, it is not used directly — the AES-256-GCM key that
encrypts every stored DSN and provider API key at rest, and it signs the session
cookie.

:::danger[It must be stable, and it must be kept]
**Lose it** and every stored connection string and provider key is
undecryptable. They must be re-entered by hand.

**Change it** and the same thing happens — this is not a rotation you can
perform casually. Every [customer key](/reference/manifest/#column-rules) a table keeps
changes with it too: the keys already stored then match nobody, so whatever is
counted per customer (one use of an offer each, the members of a group) starts again.

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

## Secrets from files (`_FILE`)

Every secret the server takes out of its environment at boot can be given as a
file instead: add `_FILE` to its name and set the path. The server reads the
file at boot and uses its contents exactly as if they had been set in the
variable itself; one trailing newline is taken off, nothing else.

```bash
ADMINIUM_SECRET_FILE=/run/secrets/adminium_secret
```

The names that take it: `ADMINIUM_SECRET_FILE`, `ADMINIUM_SETUP_TOKEN_FILE`,
`ADMINIUM_ARCHIVE_KEY_FILE`, `ADMINIUM_OPERATOR_TOKEN_FILE`,
`ADMINIUM_TRIAL_SMTP_URL_FILE`, `ADMINIUM_FIGMA_TOKEN_FILE`,
`PEXELS_API_KEY_FILE`, `UNSPLASH_ACCESS_KEY_FILE`, `PIXABAY_API_KEY_FILE`, and
every `ADMINIUM_AI_*` variable with `_FILE` added
(`ADMINIUM_AI_ANTHROPIC_API_KEY_FILE`, …).

Why: Adminium deletes these secrets from `process.env` once it has read them,
but the operating system keeps the environment a process started with, and
shows it to code running as the same user (`/proc/<pid>/environ` on Linux,
`ps eww` on macOS). A project's hooks, and the programs the server starts, run
as that user. A secret read from a file was never in that environment. The
`_FILE` variable itself is deleted from `process.env` too; its path is not a
secret, and nothing the server starts needs it. This is the form Docker
(`secrets:` in a Compose file, mounted under `/run/secrets/`) and Kubernetes
(a Secret mounted as a volume) hand secrets in.

Adminium refuses to start, with the variable named in its table, when:

- both the variable and its `_FILE` are set;
- the file does not exist, cannot be read, or is not a file;
- the file is empty (or holds only a newline);
- the file is larger than 64 KiB.

```
| ADMINIUM_SECRET_FILE | /run/secrets/adminium_secret does not exist | — |
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

At every start, before it connects, Adminium looks up each host the address
names (a `host` or `hostaddr` parameter too): one that is, or resolves to, a
cloud metadata address stops the boot. Loopback and your own network are fine,
and a name that does not resolve yet is left to the driver, so a database
container that starts a moment later is no refused boot. In trial mode and the
hosted profile the address must also pass the
[stricter check](#what-the-two-profiles-switch-off). The address is checked,
not pinned: the database driver looks the name up again itself when it
connects, so keep the name of your meta store's host in DNS you control (your
own network, a container name), not one a stranger can change.

→ [Where to put the meta store](/self-hosting/meta-store/)

:::note[The other database]
`ADMINIUM_META_URL` is where Adminium keeps its **own** state. The database you
want an admin panel **for** is a different thing, and it has its own variable —
`ADMINIUM_SOURCE_URL`, below.
:::

## `ADMINIUM_META_POOL_MAX` and `ADMINIUM_SOURCE_POOL_MAX`

Adminium keeps a pool of database connections for its meta store (10 by default, on Postgres or
MySQL; an embedded SQLite meta store has none), and for each connected source a long-lived pool
for pages and the API (10) plus short-lived ones to read the schema (5) and collect statistics
(10) — up to 25 connections to one source at a busy moment.

Lower them when that is more than the database allows you: a source reached through a
connection pooler or an SSH tunnel, a managed database with a small connection limit, or a
login role with a `CONNECTION LIMIT`. A pool larger than a role's limit does not wait for a
free connection — its extra connections are refused, and the page asking for one fails. Keep
`ADMINIUM_SOURCE_POOL_MAX` at or below a third of the data role's limit, since the three pools
can be open together; `ADMINIUM_META_POOL_MAX` below the meta role's.

```bash
ADMINIUM_META_POOL_MAX=4
ADMINIUM_SOURCE_POOL_MAX=2
```

In trial mode both default to 3, and `ADMINIUM_SOURCE_POOL_MAX` above 3 fails the boot
([Size caps in trial mode](#size-caps-in-trial-mode)).

## `ADMINIUM_RATE_LIMIT_SCALE`

For a **test server** that a browser suite drives as a handful of people. Adminium limits how many
requests each person may make a minute (300 for most of the API), how many sign-ins one address may
try (5 a minute), and how much the public API serves. A suite that signs in a few people and walks
every screen as them spends most of its time waiting for a person's minute to end. This multiplies
every one of those limits:

```sh
ADMINIUM_RATE_LIMIT_SCALE=50
```

The server logs a warning at boot saying the limits are multiplied. Unset, every limit is a real
server's. **Never set it on a server people use**: the limits are what stop password guessing and
floods. It is **ignored when `NODE_ENV` is `production`** (the Docker image sets it), and the boot
log says so. Keep one test that runs with it unset, to prove the real limits still hold.

## `ADMINIUM_STORAGE_URL`

Where uploaded files, export artifacts, the branding logo and imported schema
files are stored.

**Leave it unset unless your host has no persistent disk.** Unset means this
server's own disk, under `ADMINIUM_DATA_DIR/files` — which is correct on a
Droplet, on Fly with a volume, on Render, and on anything running Docker with a
named volume.

It matters in one situation: a runtime with **no persistent local disk**, where
files written today are gone after the next redeploy. DigitalOcean App Platform
is the main one. A destination keeps files there, but not installed apps or
add-ons — see
[Installing apps](/self-hosting/installing-apps/#on-a-host-with-no-persistent-disk).
Set this before the first boot:

```yaml
ADMINIUM_STORAGE_URL: s3://my-space?endpoint=https://nyc3.digitaloceanspaces.com&region=nyc3&pathStyle=0&accessKey=DO00EXAMPLE&secretKey=...
```

The three grammars:

| Driver | Value |
|---|---|
| Any S3-compatible bucket | `s3://<bucket>[/<prefix>]?endpoint=&region=&accessKey=&secretKey=&pathStyle=1&publicBaseUrl=` |
| A WebDAV server (a NAS, a Storage Box, Nextcloud) | `webdavs://<user>:<pass>@<host>[/<path>]?publicBaseUrl=` |
| Another directory on this machine | `file:///absolute/path` — note the three slashes |

`endpoint` is optional for AWS itself, whose endpoint is derived from the
region — and in exactly that case `region` defaults to `us-east-1`. With an
`endpoint` set it defaults to `auto` instead, which is what Cloudflare R2 and
Tigris want. `pathStyle=1` is the default whenever `endpoint` is set, because
self-hosted targets (MinIO, Garage) issue no per-bucket hostnames; managed
providers that do issue them want `pathStyle=0`. `publicBaseUrl` is a CDN or
share URL under which the objects are readable without Adminium — it is used
only for the reference stored in your own table, never as a read path.

**It runs once.** On a boot where no storage destination exists at all, it
creates one and makes it the default. On every later boot it changes nothing
and says so in the log. A destination you configured in Studio is never
overridden, and a value that will not parse is reported as a warning — the boot
continues, because Studio is where you fix it.

**A storage it cannot use stops the boot.** An endpoint a rule refuses (see
[`ADMINIUM_NETWORK_POLICY`](#adminium_network_policy)), a folder outside
[`ADMINIUM_STORAGE_DIRS`](#adminium_storage_dirs), or an endpoint whose host
cannot be looked up while no destination exists yet: `adminium start` exits
with the env-problem table naming the host, rather than quietly writing every
file to this server's disk.

### Fly.io needs none of this

`fly storage create` provisions a Tigris bucket and writes five variables into
your app's secrets: `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `BUCKET_NAME`,
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The same seed reads those as a
fallback when `ADMINIUM_STORAGE_URL` is unset, so a Fly deploy is zero-config.

The storage seed is the only code in Adminium that reads an `AWS_*` variable.
Nothing else picks up ambient AWS credentials.

## `ADMINIUM_SETUP_TOKEN`

Until the first account exists, a server asks for a one-time setup token before
it lets anyone create it ([Security](/self-hosting/security/#the-setup-token)).
Unset, Adminium derives one from `ADMINIUM_SECRET` and prints it at every boot
while setup is open:

```
Setup token: K7QD-9MXR-2FTB-WH4N
```

Set it when the log is awkward to reach, or when a deploy template can generate
one for you (a Railway `${{secret(32)}}`, a Render `generateValue: true`, a
Droplet's first boot). The log then says the token is this variable's value
instead of printing it.

```bash
ADMINIUM_SETUP_TOKEN=$(openssl rand -hex 16)
```

It is spent by the account it creates. Leaving the variable set afterwards
does nothing.

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

## `ADMINIUM_DATABASE_HOSTS`

In production (`NODE_ENV=production`, which the Docker image sets) Adminium
refuses a source database on a loopback address: `localhost`, `127.0.0.0/8`,
`::1`. Nobody signed in can then point the server at the other services on its
own machine. When your database really does run on the same server, name it here,
by host and port:

```bash
ADMINIUM_DATABASE_HOSTS=localhost:5432
```

- **Entries** are separated by commas. Each is a name (`localhost`, `postgres`, a
  Docker service name), an IPv4 address, an IPv6 address (`[::1]:5432`), or
  `*.example.com` for every name under a domain (at least two labels after the
  `*.`).
- **The port** defaults to the engine's own: 5432 for PostgreSQL, 3306 for MySQL.
  `localhost` alone lets `localhost:5432` and `localhost:3306` through, not
  `localhost:6379`.
- **Only that host and port pass.** Another port on the same host, or another
  spelling of it (`127.0.0.1` when you listed `localhost`), is still refused, so
  list each one you use.
- **Source databases only**: connections made in Studio, `ADMINIUM_SOURCE_URL`,
  and a project's databases. The meta store's own `ADMINIUM_META_URL` never
  needed it.
- **The cloud metadata address** (`169.254.169.254`, `metadata.google.internal`)
  is never allowed. A list that names it stops the boot.

An `ADMINIUM_SOURCE_URL` on loopback without a matching entry stops the boot with
the entry to add:

```
| ADMINIUM_SOURCE_URL | points at loopback; add `localhost:5432` to ADMINIUM_DATABASE_HOSTS | — |
```

A database on a Docker network under its service name (`postgres:5432`) is on a
private address, which Adminium allows without this list under the default
`ADMINIUM_NETWORK_POLICY=open`, and only with its entry under `strict`. In
[trial mode and the hosted profile](#trial-mode-and-the-hosted-profile) the
list is required and is the only way out: a source on a host not listed is
refused wherever it is, on the internet too, and on a listed host that is not
a Supabase project's only the user and database of `ADMINIUM_SOURCE_URL` may
sign in. The desktop app,
`adminium try`, and any server run without `NODE_ENV=production` allow loopback
anyway: on your own computer a local database is the normal case.

## `ADMINIUM_LOCAL_DATABASES`

The list above is the operator's way in. A super admin has a second one: Studio →
Server settings → Connections → **Allow databases on this server**. Switched on, a source
connection may reach **any** database on this server's own loopback, on any port,
as well as the hosts on `ADMINIUM_DATABASE_HOSTS`. Switching it on asks for the
super admin's password, and every change, and every refused try, is written to
the audit log. It is off by default.

```bash
ADMINIUM_LOCAL_DATABASES=off
```

- **`setting`** (the default) lets the switch decide.
- **`off`** locks it off, whatever it was set to. Studio shows the switch off and
  disabled, marked *Set by the operator*, with the hosts you allow on
  `ADMINIUM_DATABASE_HOSTS`. Use it on a server whose super admin you do not
  run the box for: with host networking, loopback is every service on it.
- **Source databases only**, like the list: connections made in Studio and a
  project's databases. Storage destinations, webhooks, AI addresses and the meta
  store keep their own rules, and the cloud metadata address is never allowed.
  `ADMINIUM_SOURCE_URL` is checked at boot against the list alone.
- **Loopback only.** Under `ADMINIUM_NETWORK_POLICY=strict` a database on the
  server's own network still needs its entry in `ADMINIUM_DATABASE_HOSTS`.
- **It never travels.** The switch is not in an export (`adminium export-zip`),
  an archive or an **Export everything** file, and an import or a restore never
  sets it: on the new server it starts off.

## `ADMINIUM_SQLITE_DIRS`

A SQLite source names a file, and Adminium opens it read and write. Adminium's
own files are refused whatever this says: the meta store and its `-wal`,
`-shm` and `-journal` files, and the data directory's `backups/`, `files/`,
`tmp/`, `add-ons/` and `pre-restore-…` folders (see
[Connect a SQLite database](/guides/connect/sqlite/#files-adminium-refuses-to-open)).
Any other file the server can open is allowed, unless you name the folders
SQLite sources must live in:

```bash
ADMINIUM_SQLITE_DIRS=/srv/databases,/data/apps
```

- **Absolute folders**, separated by commas. A relative path stops the boot.
- **Real paths are compared**: a symlink inside one of these folders that
  points out of them is refused, and so is a path that climbs out with `..`.
- **Every way in**: connections made in Studio, `ADMINIUM_SOURCE_URL` (a file
  outside the folders stops the boot) and a project's databases.
- **Not in the desktop app**, which opens whichever file its user picks. Its
  own files stay refused there too.

The refusal names the folders and what to do:

```
This SQLite file is outside the folders this server allows (ADMINIUM_SQLITE_DIRS: /srv/databases). Move the file into one of them, or ask whoever runs this server to add its folder to ADMINIUM_SQLITE_DIRS.
```

## `ADMINIUM_STORAGE_DIRS`

A storage destination of the kind *Another folder on this server* (`local`, or
`ADMINIUM_STORAGE_URL=file:///…`) names a folder, and Adminium writes every
upload under it. Adminium's own folders are refused whatever this says: the
meta store file, the data directory itself, its `backups/`, `files/`, `tmp/`,
`add-ons/` and `pre-restore-…` folders, and any folder that holds the data
directory, `/` included. Any other folder is allowed, unless you name the
folders file storage must live in:

```bash
ADMINIUM_STORAGE_DIRS=/srv/files,/mnt/uploads
```

- **Absolute folders**, separated by commas. A relative path stops the boot.
- **Real paths are compared**: a symlink inside one of these folders that
  points out of them is refused, and so is a symlink that points into
  Adminium's own folders.
- **Every way in**: saving or testing a destination in Studio, a destination
  saved before the rule (it can no longer be read or written), and
  `ADMINIUM_STORAGE_URL` (a folder Adminium refuses stops the boot).
- **Not in the desktop app**, which writes wherever its user picks. Its own
  folders stay refused there too.

## `ADMINIUM_NETWORK_POLICY`

Adminium calls three kinds of address that somebody signed in can type: a
source database's host, an automation's webhook URL, and an S3 or WebDAV
storage endpoint. Before each call it looks the name up and checks every
address the name gives:

| | `open` (default) | `strict` |
|---|---|---|
| Cloud metadata (`169.254.169.254`, `metadata.google.internal`, `fd00:ec2::254`, Alibaba's `100.100.100.200`, Oracle's `192.0.0.192`) | Refused | Refused |
| This machine (`localhost`, `127.0.0.0/8`, `::1`) | Refused in production | Refused in production |
| The server's own network: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, IPv6 `fc00::/7` | Allowed | **Refused** |
| A source database host in `ADMINIUM_DATABASE_HOSTS` | Allowed | Allowed |

```bash
ADMINIUM_NETWORK_POLICY=strict
```

Use `strict` when the people who sign in are not the people who run the
server, and the server sits on a network with other machines on it: then
nobody can make Adminium call those machines for them. Keep `open` (or leave
it unset) when a database or a MinIO bucket on your own network is the point,
such as a Docker Compose install whose database is the `postgres` service.

Under `strict`, an add-on's network calls are held to the same check, this
machine included: a host its manifest declares is looked up before each call,
refused when it is or resolves to this server or its own network, and called
at the address that passed.

- **A database on your own network under `strict`**: name it in
  `ADMINIUM_DATABASE_HOSTS` (`postgres:5432`). The list lets databases
  through, never webhooks or storage.
- **Every request is checked**: a source host before every new pool, a webhook
  before every send, a storage endpoint before a file's requests (looked up
  again at least once a minute while connections to it stay open). The
  request then goes to an address that was checked, so a name that answers
  differently a second later changes nothing.
- **A name that does not resolve is never called.** The error says so in its
  own words, `Could not look up <host>`, with the code `HOST_LOOKUP_FAILED`
  and status 502, so it is not mistaken for a refusal: check the name, or try
  again once it resolves.
- **Not in the desktop app**, which keeps `open`.

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

## `ADMINIUM_BUNDLED_APPS`

Apps that ship **with the build**. Each entry is a tarball plus its hash:

```
apps-bundle/
  clinic-1.0.0.tgz
  clinic-1.0.0.tgz.integrity     # sha512-…
```

At boot they are staged into this instance's app store, where *Studio → Hosted apps* offers them
for install. Staging is not installing: nothing is created in your database, and nothing is served,
until you pick a connection and confirm the schema plan.

**It runs once per package.** A version already staged is skipped, so a restart is cheap and an app
you installed is never disturbed by the seed. One corrupt entry costs its own package and not the
boot, and the log names it.

The point of the bundled set is the air-gapped case: an instance that can only ever use what came
with its image is a supported configuration, not a degraded one — the same reason
`ADMINIUM_BUNDLED_ADD_ONS` exists. Adminium never reaches the network to populate this. It is also
the only way an installed app survives a deploy on a host with no persistent disk: the published
image carries no apps, so build one that does — see
[Installing apps](/self-hosting/installing-apps/#on-a-host-with-no-persistent-disk).

To build one from an app checkout:

```bash
node scripts/release/pack-app-bundle.mjs ../clinic-desk --build --out apps-bundle
```

## `ADMINIUM_SURFACES_DIR`

Where the built frontends of the apps this instance hosts live. Unset — the
default — it hosts none, and nothing else about the boot changes.

A **surface** is one built frontend of an app: its `staff` side, its `customer`
side, or both. Lay them out by app key and side:

```
surfaces/
  clinic/
    staff/index.html
    customer/index.html
```

```bash
ADMINIUM_SURFACES_DIR=/srv/adminium/surfaces adminium start
```

`clinic/staff` is then served at `/apps/clinic/staff/`, and every surface found
gets a `serving hosted app surface` line in the boot log. The directory name
must be the app key the bundle was **built** with: the build bakes
`/apps/<app>/<side>/` into every asset URL, so a folder renamed after the fact
serves an `index.html` whose scripts all 404.

**Discovery runs once, at boot.** Adding an app — or rebuilding one — takes a
restart. Everything you decide about a surface afterwards is settings and takes
effect without one: where a staff surface appears (its own URL, or blended into
the dashboard sidebar), which connection it reads, which domains answer for it,
and how many instances of it you run.

A directory that is absent, empty, or misspelled is **not** an error. You get no
apps, no warning, and an empty *Studio → Hosted apps*; the boot log is where you
check, and silence there is the symptom.

A hosted **customer** surface also needs the public API admitted for pages this
instance serves itself:

```bash
ADMINIUM_PUBLIC_API_ORIGINS='self'
```

→ [An app surface on its own domain](/self-hosting/app-domains/)

## `ADMINIUM_CSP_IMG_HOSTS`

Adminium's Content-Security-Policy lets pages load pictures from Adminium itself
and nowhere else (plus, while maps are on, [the map server](#adminium_map_server)). That is right for
the dashboard's own assets, and it is one header on everything the server sends
— including the app surfaces it hosts. So when your data links images kept
somewhere else, the browser refuses them and the app shows broken pictures: a
menu whose `image_url` column points at a CDN, a product list, a page of
service photos.

Name the hosts those pictures come from:

```bash
ADMINIUM_CSP_IMG_HOSTS='https://images.example.com,https://*.cdn.example.com'
```

They are appended to `img-src`, and nothing else in the policy moves. Each entry
is a scheme and a host, with an optional port; a leading `*.` covers that host's
subdomains. Some of the example apps' demo data links its photos on
`images.unsplash.com`, so a demo database needs `https://images.unsplash.com`.

Under `adminium design`, Adminium Designer adds a host to this list in the
project's `.env` when you say yes to its card, and that host counts from the
next reply. Everywhere else the list is read once, when the server starts.

What it refuses, and why it refuses rather than guesses:

- **A bare `*` or a scheme alone (`https:`).** Either one admits pictures from
  any host, and an image request is a way to carry data out: a script that ever
  lands on your instance could send what it sees anywhere, one image at a time.
  The list exists to keep that as narrow as your real image hosting.
- **A path.** CSP matches a path as a prefix, which reads like an exact rule and
  is not one.
- **A wildcard over a whole top-level domain** (`https://*.com`).

A bad entry stops the boot with every refused value named, like any other
invalid variable. An `https://` dashboard cannot show `http://` pictures however
this is set — the browser blocks mixed content on its own.

## `ADMINIUM_ADD_ON_DEV_TRUST`

For somebody **writing** an add-on that keeps a ledger. A comma-separated list of add-on keys
whose [deciding code](/guides/add-ons-with-tables/#a-ledger-and-code-that-decides) this server
runs whatever its bytes:

```sh
ADMINIUM_ADD_ON_DEV_TRUST='stock-kit,my-ledger'
```

Without it, such code runs only from a package this server can vouch for — bundled with the
release, or downloaded from the catalogue — and a package uploaded by hand installs with every
save that would ask its code refused. The variable is **ignored when `NODE_ENV` is `production`**:
it is not a way to run unreleased code on a live server.

## `ADMINIUM_TRUST_PROXY`

Off by default, which is right for a direct-to-internet or localhost process:
without a proxy in front, `X-Forwarded-For` is attacker-controlled and trusting
it would let anyone forge their source IP in your audit log and rate limits.

Turn it **on** when — and only when — a reverse proxy you control is in front.

```bash
ADMINIUM_TRUST_PROXY=on
```

With it on, Adminium reads `X-Forwarded-For`, `X-Forwarded-Proto`,
`X-Forwarded-Host` and `X-Request-Id` only on connections from your proxy (see
the next variable). From `X-Forwarded-For` it takes the last address, the one
your proxy added.

→ [Behind a reverse proxy](/self-hosting/reverse-proxy/)

## `ADMINIUM_TRUSTED_PROXIES`

Which connections count as your proxy. The default is a connection from this
machine or from a private network:

```bash
ADMINIUM_TRUSTED_PROXIES=loopback,uniquelocal
```

That covers a Caddy or nginx on the same host (`127.0.0.1`), and a proxy
container on a Docker network (`172.16.0.0/12`). A connection from anywhere else
is treated as a client, whatever headers it sends.

The default also trusts every other machine on your private network. If any of
them can reach Adminium's port directly, name your proxy instead. Your list
replaces the default:

```bash
ADMINIUM_TRUSTED_PROXIES=127.0.0.1        # Caddy on this host, nothing else
ADMINIUM_TRUSTED_PROXIES=172.28.0.0/24    # the compose network your proxy is on
```

Each entry is an IP address, a CIDR range, or one of these names:

| Name | Ranges |
|---|---|
| `loopback` | `127.0.0.0/8`, `::1` |
| `uniquelocal` | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7` |
| `linklocal` | `169.254.0.0/16`, `fe80::/10` |

Host names such as `caddy` are not accepted. A bad entry stops the boot, and so
does setting this while `ADMINIUM_TRUST_PROXY` is off.

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

`adminium try --bridge` sets this for you, to `https://adminium.dev` and
nothing else (before 0.3.0 it was `adminium --bridge`). Set the variable
directly only if you run your own copy of that page:

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

## `ADMINIUM_MAP_SERVER`

One origin, or `off`. Default `https://tiles.openfreemap.org`.

A map is drawn in each viewer's **browser** from pictures of the part of the world on screen,
and this is the server they come from. It learns the viewer's IP address and the area they
looked at; it is never sent a row or a name from your data.

```bash
ADMINIUM_MAP_SERVER=https://tiles.example.com   # your own
ADMINIUM_MAP_SERVER=off                         # no maps on this install
```

While maps are on, this origin is added to `connect-src` and `img-src` of the
Content-Security-Policy, and to nothing else. It is there on every reply, the sign-in page's
too, because the dashboard is one page loaded before sign-in; so the origin can be read by
somebody who is not signed in, and should be a server you do not mind naming. While maps are
off, the policy names no outside server at all. Maps are off when this is `off`, in the desktop app, or when **Settings → Maps →
Show maps** is switched off; `off` here cannot be overridden from the dashboard.

It must be a scheme and a host, with an optional port: no path, no `*`, no name and password.
`http://` is taken only for `localhost`, `127.0.0.1` and `[::1]`, for a tile server on your own
machine while developing. Anything else fails the start with the reason.

The address is deliberately not editable in Settings: it goes into the policy every staff
browser obeys, and an address somebody could type there would open that policy to any server.
A project's `.env` cannot set it either on a host that opens folders it did not make (the
desktop app).

→ [Maps, places and routes](/guides/apps/maps/)

## `ADMINIUM_ROUTING_SERVER`

One origin, or `off`. Default `https://router.project-osrm.org`.

The [OSRM](https://project-osrm.org/) server your **Adminium server** asks for a route along
roads. It is asked only after somebody switches **Settings → Maps → Routes along roads** on;
until then, and with `off`, the way between stops is straight lines marked as estimates and
nothing is sent anywhere. What is sent is the ordered positions of a route's stops, and nothing
else.

```bash
ADMINIUM_ROUTING_SERVER=http://osrm.internal:5000   # your own, on a private network
ADMINIUM_ROUTING_SERVER=off                          # straight-line estimates only
```

It is called by the server, never by a browser, so it is not in the Content-Security-Policy and
may be plain `http://` on a private network. In production a loopback address (`localhost`,
`127.0.0.1`) is refused, as it is for a webhook: name the machine by its network name.
[`ADMINIUM_NETWORK_FEATURES=off`](#adminium_network_features) switches it off too.

The default is the OSRM project's public demo server: fine for trying routes out, with no
promise of being there. Adminium asks it at most once a second and keeps each answer for a day.

→ [Maps, places and routes](/guides/apps/maps/#routes-along-roads)

## `ADMINIUM_NETWORK_FEATURES`

Accepts `on`, `true`, `1` (and `off`, `false`, `0`). Default `on`.

This is a **policy** answer, not a connectivity check. Adminium never probes the
internet to find out whether it is reachable — that outbound call is exactly what
an air-gapped install is promised it will not make. So the server reports what
you told it, and the UI adapts.

Set it `off` on an install with no outbound network. Features that need the
internet — webhooks, OAuth integrations, provider-API AI enrichment, routes along
roads — then say so up front instead of being discovered one timeout at a time. Nothing is hidden:
each surface explains why it is unavailable.

It is also the one setting that stops a **new install** asking adminium.dev for what it offers.
From 0.3.16 a new install lists the add-ons and apps of adminium.dev from its first start: one
request for the two lists when it starts and once a day, which tells adminium.dev the server's IP
address, the time and its Adminium version. With `off` set before the first start, that request is
never made, and no switch in the dashboard can turn it on. A server upgraded from an earlier
version keeps the setting it had. See [Installing add-ons](/self-hosting/installing-add-ons/#the-list-from-adminiumdev)
and [Installing apps](/self-hosting/installing-apps/#the-list-from-adminiumdev).

Everything Adminium does locally is unaffected: browsing and editing data, charts,
generation, exports, scheduled reports, and the copy/paste AI round-trip all work
exactly the same.

```bash
ADMINIUM_NETWORK_FEATURES=off
ADMINIUM_TELEMETRY=off
ADMINIUM_MAP_SERVER=off
```

Together with `ADMINIUM_TELEMETRY=off` and `updates.checkEnabled` left at its
default, that is a complete no-phone-home configuration for the server.
`ADMINIUM_MAP_SERVER=off` is the line for the browsers: without it a staff
member who opens a map fetches its pictures from the map server.

## The `ADMINIUM_AI_*` block

A model can be given to the server without saving anything in **Settings → AI**. Each provider has
its own variable, so several can be set at once, and `ADMINIUM_AI_MODEL` says which model is in use:

```bash
ADMINIUM_AI_ANTHROPIC_API_KEY=sk-ant-…
ADMINIUM_AI_OLLAMA_BASE_URL=http://localhost:11434
ADMINIUM_AI_MODEL=anthropic/claude-sonnet-5-5
```

| Provider in `ADMINIUM_AI_MODEL` | Needs |
|---|---|
| `anthropic` | `ADMINIUM_AI_ANTHROPIC_API_KEY` |
| `openai` | `ADMINIUM_AI_OPENAI_API_KEY` |
| `openai-compatible` | `ADMINIUM_AI_COMPATIBLE_BASE_URL`, and `ADMINIUM_AI_COMPATIBLE_API_KEY` when the server wants a key |
| `ollama` | `ADMINIUM_AI_OLLAMA_BASE_URL` |

**What saved settings do to it.** A provider saved in Settings → AI wins: the page assistant and the
AI assist use that one. With nothing saved there they use the model the environment selects, and the
settings page says a model from the environment is in use. No key set this way is ever shown, not
even its last characters.

**In a project folder** the same six names go in the project's `.env`, and that is where
Adminium Designer writes a model you add there. They are the one part of `.env`
that is NOT copied into the server's environment: the server reads them from the file where it
calls the model, so a project's hooks and the commands it starts never see a key. A variable set in
the server's real environment (a container, a shell) wins over the file; the settings page lists
any name that is set in both with different values.

`ADMINIUM_NETWORK_FEATURES=off` still applies: only an Ollama model is called then, whatever is set.
The address of an OpenAI-compatible server or of Ollama is checked before it is called: a cloud
metadata address is always refused.

## `ADMINIUM_OPERATOR_EVENTS_URL`

Where an instance you run for somebody else tells your control service, by
itself, what you must know while it is awake. The
[operator endpoint](/self-hosting/operator-endpoint/) only answers when asked,
and a sleeping container answers nothing; these come to you.

```bash
ADMINIUM_OPERATOR_TOKEN=$(openssl rand -hex 32)
ADMINIUM_OPERATOR_EVENTS_URL=https://control.example.com/instance-events
```

- `https://…`, or `http://` only to an address of your own network or this
  machine, written as the address itself (`http://10.0.0.5:8080/events`), not
  a host name. No user name or password in it. The cloud
  metadata address is refused when it is dialled, whatever the name resolves to.
- Needs `ADMINIUM_OPERATOR_TOKEN`: every event is signed with it, and the URL
  without it stops the boot. The token does not need `ADMINIUM_OPERATOR_LISTEN`
  when this is set.
- Any server sends them, with or without trial mode. Unset, nothing is queued
  and nothing is sent.

| Event | When | `data` |
|---|---|---|
| `public-page.changed` | A customer side or a live form changed, was published or was taken down; each one at boot the first time | `{ "side": … }` or `{ "form": … }`, as [`public-content`](/self-hosting/operator-endpoint/#get-apiv1operatorpublic-content) gives it, or `{ "side": { "appKey", "removed": true } }` |
| `super-admin.signed-in` | A Super Admin signed in | `{ "ip": "203.0.113.7" }` |
| `email.cap-reached` | A cap of [your mail relay](#email-in-trial-mode) held mail back, once per cap and window | `{ "cap": "hour", "window": <ms>, "waiting": 1 }` |
| `storage.over-80` | The data folder, or a database, reached 80% of [its cap](#size-caps-in-trial-mode); once per crossing | `{ "target": "files", "usedBytes", "limitBytes" }` |

Each is a `POST` with `X-Adminium-Timestamp` and
`X-Adminium-Signature: v1=<HMAC-SHA256 of "<timestamp>.<body>">`, retried with
backoff until your service answers `2xx`. No row of the instance's data, no
name, no email is ever sent. The body of each event, the check your service
makes and the retries:
[Signed instance events](/self-hosting/operator-endpoint/#signed-instance-events).

## Trial mode and the hosted profile

For an operator who runs Adminium for other people: a trial for a stranger
(`ADMINIUM_TRIAL_MODE=on`), or a paid installation on the same server
(`ADMINIUM_HOSTED_MODE=on`). What each switches off, why, and what is left for
you to do on your own servers:
[Run Adminium for other people](/self-hosting/for-other-people/#10-trial-mode-a-trial-for-a-stranger).

Both are set by the server's environment only: no setting switches them off,
no route writes them, and a project's `.env` or config never switches either on
(nor sets an `ADMINIUM_TRIAL_*` variable), on any server. Under either, the
project's `.env` is not read at all, and its config cannot set any trial or
operator variable. Pass them
through the Docker API's `Env` array, never an env file built from user input.

A trial boot fails without `ADMINIUM_TRIAL_ENDS_AT`, `ADMINIUM_SETUP_TOKEN`,
`ADMINIUM_PUBLIC_ORIGIN` and `ADMINIUM_DATABASE_HOSTS`; a hosted boot without
the last two. Either fails on a value that contradicts it:

| Variable | Why |
|---|---|
| `ADMINIUM_NETWORK_POLICY=open` | Both run `strict`. |
| `ADMINIUM_LOCAL_DATABASES=setting` | Both keep databases on this server off; only the host list counts. |
| `ADMINIUM_RATE_LIMIT_SCALE`, `ADMINIUM_ADD_ON_DEV_TRUST`, `NODE_OPTIONS` | They widen limits, trust add-on code or change what the server loads. |
| `ADMINIUM_BRIDGE_ORIGINS`, `ADMINIUM_DEMO_SEED_SCRIPT`, `ADMINIUM_RUNTIME=desktop` | Not for a server other people use. |
| `ADMINIUM_STORAGE_URL`, `AWS_ENDPOINT_URL_S3` | Files stay in the data folder. |
| `ADMINIUM_TELEMETRY=on`, `ADMINIUM_MAP_SERVER`, `ADMINIUM_ROUTING_SERVER` (not `off`) | Trial mode only: a trial calls nothing but yours. |

A control character fails the boot too: on any server, in a trial, hosted,
operator or start prompt variable; under either profile, also in every other
variable the operator decides (the host list, the folders, the network policy,
the setup token, the deploy link, Connect Supabase). So does a trial variable
(`ADMINIUM_TRIAL_*`) set without trial mode, and in a trial
`ADMINIUM_SOURCE_POOL_MAX` above 3. Saying what a
profile implies is fine: `ADMINIUM_NETWORK_POLICY=strict` passes. What a profile
implies is enforced whatever the variable holds, so Studio shows those settings
read-only, marked **Set by the operator**.

### What the two profiles switch off

Each refusal is a `403` with the code `OFF_BY_OPERATOR` and
`details: { question, reason }` (`reason` is `trial-mode`, `hosted-mode`,
`trial-ended` or `size-cap`), so the dashboard says what is off in the
person's language, except where the table of switches names another answer.
Every screen that offers one of these shows it disabled with that reason, never
hidden. The table, with the trial's and the hosted profile's answer for each:
[What it switches off, and why](/self-hosting/for-other-people/#what-it-switches-off-and-why).

The meta store's own address is checked at every boot: on every install, a
host in `ADMINIUM_META_URL` (or in the address a move wrote to `adminium.json`)
that is, or resolves to, a cloud metadata address stops the boot. Under both
profiles it must also pass the check a typed meta-store address does: only the
query parameters a source connection may carry, and a name that resolves.
Loopback stays allowed.

`GET /api/v1/readyz?deep=1` also waits until installed add-ons are loaded:
point a waker at it before it sends the first request.

### Size caps in trial mode

A trial has limits a hosted installation drops (your own quotas on the database
server and the volume stay yours to set):

- **Live data per database**, `ADMINIUM_TRIAL_DATA_MAX_MB` (default 500). Every
  source on one of your hosts (not the person's own Supabase project) is
  measured at boot, every 10 minutes, before each import, and again soon after
  anything is written to it: within seconds of a delete. What counts is the
  data the rows hold now, not the files on your server's disk, which do not
  shrink after a delete until a `VACUUM FULL`. On Postgres that is each table's
  live rows (`pg_stat_user_tables`) times the size of one row read from a
  sample, plus its indexes in the share of rows that are live; on MySQL, each
  table's row count times the length of one row from a sample, plus its
  indexes in the share its pages are still filled. Adminium's own `adminium_*`
  tables do not count. Past the limit the database is **held by the size
  cap**: inserts, updates and anything that adds a table, column or index are
  refused (`403 OFF_BY_OPERATOR`, `question: dataOverCap`, `reason: size-cap`),
  while deletes, `TRUNCATE` and `DROP` still run. The hold lets go once the
  database is under 90% of the limit. Every data page of a held database says
  so. A connection test leaves the hold as it is.
- **Each uploaded file**, `ADMINIUM_TRIAL_UPLOAD_MAX_MB` (default 10): staff
  uploads, files strangers send through forms and the public API, and files
  brought in to import (`413 FILE_TOO_LARGE`). The installation's own limits
  (`files.maxBytes`, the public-upload quotas) can be lower, never higher.
- **The data folder**, `ADMINIUM_TRIAL_STORAGE_MAX_MB` (default 1,000): every
  file under `ADMINIUM_DATA_DIR`, walked at boot and every 10 minutes. Past it,
  uploads, the Designer's writes and exports (Export everything included) are
  refused (`question: storageOverCap`) until files are deleted.
- **At most 3 source connections**, a fourth refused
  (`question: extraSourceConnections`), each with pools of at most 3
  (`ADMINIUM_SOURCE_POOL_MAX`, default 3), and a meta store pool of 3 unless
  `ADMINIUM_META_POOL_MAX` says otherwise.

`GET /api/v1/system/size-caps` (signed in) answers the last readings.

### Public pages in trial mode

A trial's public pages (customer sides, forms, the mail door, the public API)
answer everyone, but no search engine may index them: every response carries
`X-Robots-Tag: noindex, nofollow`, every HTML page a
`<meta name="robots" content="noindex, nofollow">`, and `/robots.txt` on every
host disallows everything, over any robots.txt an app ships. Pay pages
(`/pay…`) and inbound payment webhooks answer 403, as a trial has no payment
provider. A hosted installation keeps neither rule.

### Email in trial mode

All of a trial's email is on, and all of it goes through your relay
(`ADMINIUM_TRIAL_SMTP_URL`): the person's own mail server setting is shown
read-only, marked **Set by the operator**, and a change to it through
`PUT /api/v1/settings/email` is refused (409 `SET_BY_OPERATOR`). With no relay
set, a trial sends no email at all.

- **From** is always `"<instance name> via <ADMINIUM_OPERATOR_NAME>" <ADMINIUM_TRIAL_MAIL_FROM>`.
  The instance name is the **Application name** (Studio's Server identity) with everything a header or an
  address is made of taken out, and is dropped for the instance's host name
  when it holds a brand or an account-safety word (`PayPal`, `Microsoft`,
  `login`, `password`…) in any spelling, look-alike letters and digits
  included. Have your relay pin the same address for the instance's credential.
- **Reply-To**, on mail the person wrote, is a staff member's own sign-in
  address: the one the mail asked for when it is one, else the first Super
  Admin's.
- **A footer** on mail the person wrote names the instance's address
  (`ADMINIUM_PUBLIC_ORIGIN`) and links to `ADMINIUM_TRIAL_MAIL_REPORT_URL`.
- **Account email** (password reset, invitation, sign-in code, address changed)
  says Adminium's own words, whatever was edited or translated on the
  instance, and has its own quota of 50 a day and 20 an hour that mail the
  person wrote never uses up. Past it, account email is not sent.
- **Mail the person wrote** is capped at `ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY` a
  day (default 50), 20 an hour and 20 different people a day (UTC). Past a
  cap it waits in the outbox and goes out in the first hour the caps leave
  room in; Studio's Email settings say how many wait and list them. Five
  bounced addresses or one spam report in a day (what the do-not-email list
  learns from your relay's refusals and the mail services' notices) hold it
  until the next day. Nothing is queued to go after the trial's end, and what
  waits does not go then.
- **Marketing mail** is off: campaigns cannot be sent (403 `OFF_BY_OPERATOR`,
  `question: marketingCampaigns`), and mail classed as marketing is not queued.

Your relay should cap each instance too: these limits are a courtesy, its own
are the limit, so allow at least the user cap plus 50 account emails a day.
The [operator endpoint](/self-hosting/operator-endpoint/) reports the user
emails sent today and this hour.

### Your addresses for the instance

With `ADMINIUM_PUBLIC_ORIGIN` or `ADMINIUM_OPERATOR_DOMAINS` set, on any server:

- the instance answers only on `ADMINIUM_PUBLIC_ORIGIN`'s host and the listed
  domains. Any other `Host` gets **421** before a route is reached. Behind a
  trusted proxy (`ADMINIUM_TRUST_PROXY`) the name compared is the one the proxy
  forwards (`X-Forwarded-Host`), so a proxy that passes any name through, or
  writes its upstream into `Host`, changes nothing;
- `GET /api/v1/healthz` and `GET /api/v1/readyz` answer on every host, so a
  container's health check can dial it by its address. They say only whether
  the server is alive and ready;
- the address in email links (`system.publicOrigin`) is `https://` and the first
  listed domain, else `ADMINIUM_PUBLIC_ORIGIN`. It is written at every boot,
  Studio shows it read-only, a change through `PUT /api/v1/settings/email` is
  refused (409 `SET_BY_OPERATOR`), and the server never learns another from a
  browser;
- a domain mapped to an app's side or to the add-on pages must be one of the
  listed domains, and not the first, where email links point (403 otherwise).
  A mapping saved before is not answered.
  Under trial mode and the hosted profile, the websites that may show a form in
  a frame must be listed domains too.

### The hosted profile

`ADMINIUM_HOSTED_MODE=on` is for an installation someone pays you for on your
server, typically a trial after its Upgrade. Its Super Admin is still somebody
else on your machine and your network, so the profile keeps what would let
their code or their connections reach you, and drops what only limits a free
trial: the end date, the banners, the Upgrade button, the size caps and the
pools of 3, `noindex`, mail only through your relay, and the outgoing calls of
trial mode. It needs `ADMINIUM_PUBLIC_ORIGIN` and `ADMINIUM_DATABASE_HOSTS`;
no end date and no setup token. Every `ADMINIUM_TRIAL_*` variable left set
fails its boot.

What it keeps and drops, switch by switch, and the Upgrade from a trial:
[A paid installation: the hosted profile](/self-hosting/for-other-people/#12-a-paid-installation-the-hosted-profile).

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
`ADMINIUM_RUNTIME=desktop` on a server would create it, and would also stop the
server asking for the [setup token](/self-hosting/security/#the-setup-token). Do
not. A project's `.env` cannot set it at all: `adminium start`, `dev` and
`design` ignore the line and say so.

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

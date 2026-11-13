---
title: Run Adminium for other people
description: The settings that matter when you run the server and somebody else signs in as its super admin, from a client of your agency to a stranger on a free trial, and what is left for you to do.
sidebar:
  order: 8
---

This page is for you if you run the server and somebody else uses it: a client
of your agency, a class, a team you set Adminium up for, or a stranger who
signed up for a trial on your site. They sign in as a super admin and can
connect databases, add storage and write automations. You keep the machine,
its network, its other services and its secrets.

Out of the box Adminium assumes the person who signs in also runs the server.
The settings below draw the line between the two of you. Each one has its own
section elsewhere in these docs; this page says which ones to set and why.

- **Somebody you know** (sections 1 to 9): you pick the settings that fit.
- **A stranger** (sections 10 to 13): [trial mode](#10-trial-mode-a-trial-for-a-stranger)
  and the [hosted profile](#12-a-paid-installation-the-hosted-profile) set
  them for you, refuse to start when one is missing, and keep the person from
  switching any of them off. Some of the work stays yours, outside Adminium:
  [your part](#11-your-part-outside-adminium).

## 1. Create the first account before anyone else can

A fresh server asks for a one-time **setup token** before it creates the first
account, and prints the token in its log. Nobody who only finds the address can
take the instance. Either create the first account yourself and invite your
client, or hand them the token (or a link to
`https://<your address>/setup#setup-token=<token>`) by a channel you trust.

Set your own token with `ADMINIUM_SETUP_TOKEN` when your deploy tool can
generate one, so you never have to read the log. A trial needs one:
[the welcome link](#the-welcome-link).

→ [The setup token](/self-hosting/security/#the-setup-token) ·
[`ADMINIUM_SETUP_TOKEN`](/self-hosting/env-vars/#adminium_setup_token)

## 2. Decide which databases on your server they may reach

In production Adminium refuses a source database on the server's own loopback
(`localhost`, `127.0.0.1`). On a one-server install with host networking,
loopback is every service on the box, not only the database you set up for
them.

- **Name the database you mean** with `ADMINIUM_DATABASE_HOSTS`, by host and
  port (`localhost:5432`). Only that host and port pass.
- **Lock the super admin's switch off** with `ADMINIUM_LOCAL_DATABASES=off`.
  Otherwise a super admin can turn on **Allow databases on this server** in
  Studio, which lets their connections reach any port on your loopback. With
  `off` the switch shows disabled, marked *Set by the operator*, with your list.

```bash
ADMINIUM_DATABASE_HOSTS=localhost:5432
ADMINIUM_LOCAL_DATABASES=off
```

→ [`ADMINIUM_DATABASE_HOSTS`](/self-hosting/env-vars/#adminium_database_hosts) ·
[`ADMINIUM_LOCAL_DATABASES`](/self-hosting/env-vars/#adminium_local_databases)

## 3. Keep them off your own network

By default Adminium may call addresses on the server's own network
(`10.x`, `192.168.x` and the like), because a database or a bucket next to
Adminium is the usual case. When that network holds machines your client
should not reach, set `strict`. Source databases, webhooks and S3 or WebDAV
storage then refuse private addresses; databases you named in
`ADMINIUM_DATABASE_HOSTS` still pass. The user's own mail server, the AI
addresses a user saves (Ollama included) and add-ons' network calls refuse this
machine as well as private addresses.

```bash
ADMINIUM_NETWORK_POLICY=strict
```

The cloud metadata address, where a cloud server keeps its own credentials, is
refused under either policy.

→ [What Adminium may call](/self-hosting/security/#what-adminium-may-call) ·
[`ADMINIUM_NETWORK_POLICY`](/self-hosting/env-vars/#adminium_network_policy)

## 4. Pin the folders they may use

A SQLite source and a "folder on this server" storage destination name a path
on your disk. Adminium's own files are refused whatever you set. To keep your
client inside folders you chose, name them:

```bash
ADMINIUM_SQLITE_DIRS=/srv/client/databases
ADMINIUM_STORAGE_DIRS=/srv/client/files
```

→ [`ADMINIUM_SQLITE_DIRS`](/self-hosting/env-vars/#adminium_sqlite_dirs) ·
[`ADMINIUM_STORAGE_DIRS`](/self-hosting/env-vars/#adminium_storage_dirs)

## 5. Keep your secrets yours

A project's hooks and actions run inside the server, and the Designer can start
programs: an app's tests, a build, a package install. Once the server has
started, `ADMINIUM_SECRET`, the setup token, the archive key, your AI keys and
the other keys you set are no longer in `process.env`, and every program the
server starts gets a short, named environment without them.

That is not the whole way. The operating system still shows the environment
the server **started** with to code running as the same user, and a hook or a
program the server started runs as that user. So give each secret as a file
(`ADMINIUM_SECRET_FILE=/run/secrets/adminium_secret`, the same `_FILE` ending
for the others), as Docker and Kubernetes secrets do: then the value is never
in any environment. A secret given as a plain variable keeps working, but
stays readable that way.

Give each instance its own random `ADMINIUM_SECRET`. Two instances that share
one accept each other's signed values.

→ [Out of reach once the server has started](/self-hosting/security/#out-of-reach-once-the-server-has-started) ·
[Secrets from files](/self-hosting/env-vars/#secrets-from-files-_file) ·
[`ADMINIUM_SECRET`](/self-hosting/env-vars/#adminium_secret)

## 6. Moving the instance, or handing it over

Two files, for two different jobs:

| | `adminium archive create` | **Export everything** |
|---|---|---|
| For | Moving or backing up the instance you run | Handing your client their work |
| Passwords and secrets | Kept (secrets stay encrypted) | Left out |
| Signed | Yes; a restore refuses an altered file | No |
| Read back with | `adminium archive restore` | `adminium import-zip` |

A restore checks connection strings, storage addresses, folders and domains
again under the new server's settings, and switches off whatever they refuse.
**Allow databases on this server** never travels in either file, and neither
do your own counts and holds (the AI spent, whether the start prompt ran, hidden
public pages): a restore leaves those the new server already has as they are,
and the AI budget there counts from what that server spent. When each
instance has its own secret, set the same `ADMINIUM_ARCHIVE_KEY` on both
servers.

Your client can download **Export everything** from Studio themselves. On a
server without a terminal, `adminium import-zip` needs `--owner <email>` when
the file holds more than one super admin.

To check that a copy starts before you delete the original (a data folder
copied to another server, say), start the copy once with
`ADMINIUM_SCHEDULER=off`, wait for `GET /api/v1/readyz`, then stop it. With the
switch off, no schedule ticks and no queued job runs: the reports,
automations, mail and [events](#9-read-its-totals-and-hide-its-public-pages)
that are due wait in the copy's queue, so none runs on the copy and again on
the original. Never leave it off on an instance people use.

→ [Back up and move an instance](/self-hosting/archive/) ·
[Export everything from Studio](/self-hosting/export-everything/)

## 7. The "Put this online" link

Studio's user menu, its Export everything page and About carry **Put this
online…**, a link to [adminium.dev/deploy](https://adminium.dev/deploy) with
ways to host an installation. If you offer hosting yourself, or rebrand, hide
it:

```bash
ADMINIUM_DEPLOY_LINK=off
```

→ [Environment variables](/self-hosting/env-vars/#the-complete-list)

## 8. Connect Supabase

If you run a service that signs people in to Supabase and lets them pick or
create a project, Adminium can take the connection from it, once. Set the
service's address:

```bash
ADMINIUM_SUPABASE_CONNECT_URL=https://connect.example.com/supabase
```

The connect wizards then show **Connect Supabase** above the connection-string
form, which stays for everyone. Adminium never talks to Supabase itself: the
sign-in, its client secret, the token and the project list stay with your
service. It must be `https://`, or the server does not start.

**What your service must do.**

1. **The page.** The browser arrives at your address with `instance` (the
   instance's address the person is signed in on: `ADMINIUM_PUBLIC_ORIGIN`, or
   `https://` and one of `ADMINIUM_OPERATOR_DOMAINS`), `state` and `challenge`
   (`base64url(SHA-256(verifier))`, no padding, as in PKCE's S256). After the
   sign-in, send the browser to
   `<origin>/connect/supabase/return?state=<state>&code=<code>`, where
   `<origin>` is **one of the origins you registered for that instance**: the
   one `instance` names when it is one of them, since the person's session
   belongs to that host. Never send it to an `instance` you did not register:
   that would make your page an open redirect. Make `code` random, single use, short-lived (a minute is plenty),
   and keep the `challenge` with it.
2. **The redeem.** The instance calls `POST <address>/redeem` with
   `{"code": "…", "verifier": "…"}`. Refuse a code that is unknown, spent or
   expired with `410`, and one whose `SHA-256(verifier)` is not its challenge
   with `400`. Answer within 10 seconds, with at most 64 KB of JSON, and no
   redirect: the instance follows none and refuses the answer.
3. **The answer.**

   | Field | What it must be |
   |---|---|
   | `engine` | `"postgres"` |
   | `host` | A plain host name, such as `aws-0-eu-central-1.pooler.supabase.com`. No address, port or path. |
   | `port` | An integer. |
   | `database`, `user` | Letters, digits, `_`, `.` and `-` only. |
   | `sslmode` | `"require"` (encrypted) or `"verify-full"` (encrypted, the certificate checked against the system's). |
   | `password` | For a project you just created. **Leave it out for an existing project**: the instance asks the person for it on its own page, and it never reaches you. |
   | `project` | Optional: the project's name, shown to the person and used to name the connection. |

   Any other field is ignored. An answer that breaks a rule is refused, and the
   person sees *Supabase connection expired.* with a button to start again.

The host must still pass this server's own rules for databases. On an
ordinary server, under `ADMINIUM_NETWORK_POLICY=strict` too, Supabase's hosts
are public addresses and pass. In trial mode and the hosted profile the host
list is the only way out, so list Supabase's hosts there as well
(`*.pooler.supabase.com:5432,*.pooler.supabase.com:6543`, and
`*.supabase.co:5432` for a project's direct address), or every answer is
refused.

The audit log records each start, success and refusal (with the host and the
reason), never a connection string or a password.

**Trying it on your computer.** The repository has a fake service that plays
both sides and answers each of the cases above:

```bash
node scripts/dev/fake-connect-operator.mjs --database postgres://you@localhost:5432/shop --instance http://localhost:4600
```

It prints the two variables to start Adminium with
(`ADMINIUM_SUPABASE_CONNECT_URL` and `NODE_EXTRA_CA_CERTS`, since it serves
https with a certificate of its own). It also puts TLS in front of your local
Postgres, which usually has none, because the answer asks for it.

→ [Environment variables](/self-hosting/env-vars/#the-complete-list)

## 9. Read its totals, and hide its public pages when you must

The [operator endpoint](/self-hosting/operator-endpoint/) is a second listener on
your own network, behind a token only you hold: how much disk the instance uses,
when its Super Admins last signed in and from where, what it serves to the
public, and one call that hides every public page at once while you sort
something out with its owner. Staff pages keep working, and Studio tells the
owner why.

→ [The operator endpoint](/self-hosting/operator-endpoint/) ·
[Refuse the operator paths at the proxy](/self-hosting/reverse-proxy/#refuse-the-operator-paths)

## 10. Trial mode: a trial for a stranger

`ADMINIUM_TRIAL_MODE=on` is for an instance you hand to somebody you do not
know, on your own servers, until a date: a free trial on your site, a sandbox
for a workshop. They are its Super Admin. You share your database server, your
mail relay and your network with every other trial you run, so trial mode
switches off everything that would let them reach those, and adds a clock,
banners and size caps. A paid installation keeps most of it:
[the hosted profile](#12-a-paid-installation-the-hosted-profile).

It is set by the environment of the container and nothing else. No setting
switches it off and no route writes it. The project's `.env` is not read at
all, and its config cannot set any trial or operator variable. What trial mode
implies (`ADMINIUM_NETWORK_POLICY=strict`, `ADMINIUM_LOCAL_DATABASES=off`, no
telemetry, no map or routing server) is enforced, not defaulted: left unset,
those variables read as the profile says, and set to anything else, they stop
the boot. Studio shows those settings read-only, marked **Set by the
operator**.

### The variables

With `ADMINIUM_TRIAL_MODE=on`, the server refuses to start without the next
four (or `ADMINIUM_SECRET`, as always), and names the one missing.

| Variable | Needed | Default | What it is |
|---|---|---|---|
| `ADMINIUM_TRIAL_MODE` | **Yes** | `off` | `on`. |
| `ADMINIUM_TRIAL_ENDS_AT` | **Yes** | — | When the trial ends, with its zone: `2026-12-01T00:00:00Z`. |
| `ADMINIUM_SETUP_TOKEN` | **Yes** | — | The one-time token your [welcome link](#the-welcome-link) carries. At least 16 characters. |
| `ADMINIUM_PUBLIC_ORIGIN` | **Yes** | — | Your address for this instance, `https://hollis.try.example.com`. It answers there only (any other `Host` gets `421`), and links in its email point there. |
| `ADMINIUM_DATABASE_HOSTS` | **Yes** | — | The only database hosts it may reach: `pg-trials:5432`. See [Databases](#databases-the-host-list-and-one-login). |
| `ADMINIUM_SECRET` | **Yes** | — | As on any server. Its own random one per instance: [your part](#11-your-part-outside-adminium). |
| `ADMINIUM_SOURCE_URL` | In practice | *(unset)* | The database and login you made for this trial, connected on the first boot. On your own hosts it is the only login allowed; unset, none is. |
| `ADMINIUM_TRIAL_SMTP_URL` | No | *(unset)* | Your mail relay, with this instance's own credential. Unset, the trial sends no email at all. A secret: takes `_FILE`. |
| `ADMINIUM_TRIAL_MAIL_FROM` | With the relay | — | The address your relay pins for this instance, `i-7f3a9c@relay.example.com`. |
| `ADMINIUM_OPERATOR_NAME` | No | the From address's domain | Your name, as mail says it: `"<instance name> via <your name>"`. |
| `ADMINIUM_TRIAL_MAIL_REPORT_URL` | No | `mailto:abuse@` the From address's domain | Where a recipient reports a mail, linked in the footer of mail the person wrote. |
| `ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY` | No | `50` | Mail the person wrote, per day (and always 20 an hour). |
| `ADMINIUM_TRIAL_DATA_MAX_MB` | No | `500` | Live data per database on your hosts. |
| `ADMINIUM_TRIAL_UPLOAD_MAX_MB` | No | `10` | Per uploaded file. |
| `ADMINIUM_TRIAL_STORAGE_MAX_MB` | No | `1000` | The whole data folder. |
| `ADMINIUM_TRIAL_UPGRADE_URL` | No | *(unset)* | Your Upgrade page. Unset, there is no Upgrade button. |
| `ADMINIUM_SOURCE_POOL_MAX`, `ADMINIUM_META_POOL_MAX` | No | `3` | Connections per pool. The first may not go above 3 in a trial. |

The rest are the ones any operator may set, and work the same in a trial:
`ADMINIUM_OPERATOR_DOMAINS` (the person's own domains, once you verified
them), the [operator endpoint and events](#watch-it-and-hide-its-public-pages)
(`ADMINIUM_OPERATOR_TOKEN`, `_LISTEN`, `_EVENTS_URL`), your AI connection and
its limits (`ADMINIUM_AI_*`, `ADMINIUM_AI_OPERATOR_*`), a
[start prompt](/projects/designer/#a-start-prompt),
[Connect Supabase](#8-connect-supabase), `ADMINIUM_DESIGNER=live` if the trial
offers [the Designer](/projects/designer/#on-a-server-people-reach), and
`ADMINIUM_DEPLOY_LINK=off`. Every variable, its format and its limits:
[Environment variables](/self-hosting/env-vars/#trial-mode-and-the-hosted-profile).

The boot also fails on a value that would undo the profile (an explicit
`ADMINIUM_NETWORK_POLICY=open`, `ADMINIUM_RATE_LIMIT_SCALE`, a `NODE_OPTIONS`
that says more than the heap size, a seeded storage destination, telemetry or a map server switched on…), on a
control character in any trial or operator variable, and on a trial variable
set without trial mode:
[the full list](/self-hosting/env-vars/#trial-mode-and-the-hosted-profile).

### What it switches off, and why

Each line is one switch. Where the person meets one, the screen shows it
disabled with the operator's reason, never hidden. Unless the last column says
otherwise, the server refuses it with `403 OFF_BY_OPERATOR` and
`details: { question, reason }`, where `reason` is `trial-mode`,
`hosted-mode`, `trial-ended` or `size-cap`.

**Your database server and your network.** You share them with every other
trial. Another login on your database server is somebody else's, and your
network holds machines no trial should reach.

| | Trial | Hosted | |
|---|---|---|---|
| A source database on a host not on `ADMINIUM_DATABASE_HOSTS` | Off | Off | |
| On one of your hosts, a login other than `ADMINIUM_SOURCE_URL`'s user and database | Off | Off | |
| A SQLite file as a source | Off | Off | |
| **Allow databases on this server** (`ADMINIUM_LOCAL_DATABASES=off`) | Off | Off | Shown locked |
| The server's own network for databases, webhooks, storage, the user's own SMTP server, AI addresses a user saves and add-ons' network calls (`strict`) | Off | Off | As under `strict` |
| More than 10 database connection tests a minute, for the whole installation | Off | Off | `429 RATE_LIMITED` |
| Moving or adopting the meta store (`/meta/relocate`, `/setup/probe`, `/setup/adopt`), setup token or not | Off | Off | |
| Storage destinations other than the data folder | Off | Off | |

**Code of their own.** It would run on your server, unsandboxed, beside your
network and with the server's own access.

| | Trial | Hosted | |
|---|---|---|---|
| Uploading an add-on or an app (catalog and bundled ones install as usual) | Off | Off | |
| The Designer's site zip, styles of one's own and the Code tab's hand save | Off | Off | |
| Code the server would run: hooks, actions, build files, the app's tests, npm packages, an app's own build, **Start with an app** | Off | Off | |
| The project's `.env` | Not read | Not read | |

The Designer still builds an app's tables, pages, manifest and screens; it
only never writes code the server runs.

**Calls out.** A trial calls nothing of the person's choosing: your hosts and
your relay, the add-on and app catalog, and the AI provider of their own key.
A paid installation may call the internet, never your network.

| | Trial | Hosted | |
|---|---|---|---|
| The automation webhook step and Slack message | Off | On | |
| Every add-on's network calls, declared hosts included | Off | On | |
| Payment services, pay pages and inbound payment webhooks | Off | On | |
| The Designer's picture search and Figma | Off | On | |
| Maps, routing, telemetry and the update check | Off | On | The two settings shown locked |
| Their own mail server: all mail goes through your relay | Off | On | `409 SET_BY_OPERATOR` |
| Marketing campaigns | Off | On | |
| An AI address of their own, and the OpenAI-compatible and Ollama providers (their own key to Anthropic, OpenAI or Google stays) | Off | On | Off on any server with `ADMINIUM_AI_OPERATOR_ONLY=on` |

**Your addresses.** Mail the instance sends carries links, and those must point
at an address you gave it, never one a visitor chose.

| | Trial | Hosted | |
|---|---|---|---|
| Answering on any host name | Off | Off | `421` |
| Changing the address in email links | Off | Off | `409 SET_BY_OPERATOR` |
| Mapping a domain you did not list, or letting another website frame its forms | Off | Off | Also on an ordinary server with `ADMINIUM_OPERATOR_DOMAINS`, reason `not-allowed` |
| Search engines indexing its public pages | Off | On | `noindex` everywhere |

**The trial itself.** These only limit a free trial.

| | Trial | Hosted | |
|---|---|---|---|
| Writes, once `ADMINIUM_TRIAL_ENDS_AT` has passed (signing in, setup and exports go on) | Off | — | |
| Public pages, once it has passed | Off | — | `404` |
| Mail the person wrote, once it has passed (account email goes on) | Off | — | Not queued |
| Adding data past `ADMINIUM_TRIAL_DATA_MAX_MB` (deleting goes on) | Off | — | |
| Uploads, the Designer's writes and exports past `ADMINIUM_TRIAL_STORAGE_MAX_MB` (Export everything goes on) | Off | — | |
| A file over `ADMINIUM_TRIAL_UPLOAD_MAX_MB` | Off | — | `413 FILE_TOO_LARGE` |
| A fourth source connection | Off | — | |

Every page also carries two strips that cannot be closed, on the sign-in and
setup screens too: "This is a test environment. Please don't put real customer
data in." and the days left, with **Export everything** and, when you set
`ADMINIUM_TRIAL_UPGRADE_URL`, **Upgrade**. The details of each part:
[size caps](/self-hosting/env-vars/#size-caps-in-trial-mode),
[public pages](/self-hosting/env-vars/#public-pages-in-trial-mode),
[email](/self-hosting/env-vars/#email-in-trial-mode),
[addresses](/self-hosting/env-vars/#your-addresses-for-the-instance).

### The welcome link

Your sign-up flow creates the container with its own `ADMINIUM_SETUP_TOKEN`
and sends the person a link to it:

```text
https://hollis.try.example.com/setup#setup-token=3f9c0a7d5e21b8c64a90d3e7f1b2c5a8
```

- **After `#`, never `?`.** A browser never sends what follows `#` to a
  server or a proxy, so the token is in no log. The wizard reads it, removes it
  from the address bar and asks for nothing else. The link works on any path
  of the instance (`/`, `/login`) while setup is open.
- **Make it random**: `openssl rand -hex 16`. Case, spaces and dashes do not
  count when it is compared, so hex keeps every bit.
- **One account, then spent.** It is checked and deleted in the transaction
  that creates the account; the link does nothing afterwards. The server never
  prints a token you set.
- The setup pages answer with `Referrer-Policy: no-referrer`, so they never
  hand their address to another site. Keep the query strings of the setup
  path out of your proxy's logs all the same:
  [the setup token in your logs](/self-hosting/reverse-proxy/#keep-the-setup-token-out-of-your-logs).

### Databases: the host list and one login

On an ordinary server, `ADMINIUM_DATABASE_HOSTS` lets a few databases on the
server's own machine through. In trial mode and the hosted profile it is the
only way out: a source on any host not listed is refused, on the internet too.
List your database server as the trial's container reaches it, and Supabase's
hosts if you offer [Connect Supabase](#8-connect-supabase) or the person may
bring their own project:

```bash
ADMINIUM_DATABASE_HOSTS=pg-trials:5432,*.pooler.supabase.com:5432,*.pooler.supabase.com:6543,*.supabase.co:5432
ADMINIUM_SOURCE_URL=postgres://trial_7f3a9c:…@pg-trials:5432/trial_7f3a9c
```

- **One login on your hosts.** On a listed host that is not a Supabase
  project's (`*.supabase.com`, `*.supabase.co`), a connection must use the user
  and the database of `ADMINIUM_SOURCE_URL`. Any other, however they learnt it,
  is refused before a packet leaves. Without `ADMINIUM_SOURCE_URL`, no login on
  your hosts is allowed, and an `ADMINIUM_SOURCE_URL` that names no user or no
  database stops the boot. Their own Supabase project takes their own login.
- **No SQLite**, no database on the container's own loopback, nothing on your
  private network that is not listed. A MySQL source passes only through an
  entry on MySQL's port.
- **Small.** At most 3 source connections, pools of at most 3, and 10
  connection tests a minute for the whole installation.
- **The meta store is yours.** Its address comes from your environment and
  cannot be moved from Studio or the setup screens. At boot it must pass the
  check a typed connection does (only the query parameters a source may carry,
  a name that resolves, never a cloud metadata address).

Adminium refusing a login is a courtesy to the trials. Your database server
refusing it is the rule: [your part](#postgres).

### Watch it, and hide its public pages

Not limited to trial mode: on any server you run for somebody else, the
[operator endpoint](/self-hosting/operator-endpoint/) answers on your own
network with the instance's totals (storage, mail sent, Super Admin sign-ins,
your AI spent) and what it serves to the public, and hides every public page
at once when you must. While it is awake the instance also sends you
[signed events](/self-hosting/operator-endpoint/#signed-instance-events): a
public page changed, a Super Admin signed in, a mail cap reached, storage at
80%. A sleeping container sends nothing, so read the endpoint, or its volume,
before you archive it.

### Waking it

A sleeping container is woken by your proxy or your control service. Before
you send it the person's first request, wait for:

```text
GET /api/v1/readyz?deep=1
```

It answers `503` until the meta store answers, the bundled apps and add-ons
are in place and the installed add-ons are loaded, then `200` with
`"ok": true`. It answers on any host name, so you can dial the container by its
address.

If your proxy wakes a container only for a page open, answer the other requests
to a sleeping one with a `503`, `Retry-After` and the header `X-Aapp-Asleep: 1`:
a dashboard that gets that answer to an API read reloads its page, which is a
page open, at most once in 30 seconds. A save that gets it fails with your
message instead, so what the person typed stays on the page.

If your proxy puts an instance to sleep when nobody has used it for a while,
set `ADMINIUM_PRESENCE=on`: while a dashboard tab is visible and its person
moved, typed or scrolled in the last 5 minutes, it sends
`GET /api/v1/presence` once a minute (an empty `204`), so someone reading a
page counts as using it. A hidden tab sends nothing. Off, nothing is sent.

Scheduled work (reports, automations) runs only while the container
is awake. →
[Healthchecks](/self-hosting/docker-compose/#healthchecks)

## 11. Your part, outside Adminium

Trial mode limits what the instance does. It cannot limit your database
server, your relay or your proxy, which other trials share, and it does not
end a trial: at the end date the container keeps running, read-only, until you
stop it (no request writes, and no scheduled automation, timed move, report or
queued job of theirs runs; exports, the server's own mail and your events go
on). These are yours.

### Postgres

Give each trial a role and a database of its own, and let the server enforce
the limits:

```sql
CREATE ROLE trial_7f3a9c LOGIN PASSWORD '…' CONNECTION LIMIT 12;
CREATE DATABASE trial_7f3a9c OWNER trial_7f3a9c TABLESPACE trials_quota;
REVOKE CONNECT ON DATABASE trial_7f3a9c FROM PUBLIC;
ALTER ROLE trial_7f3a9c SET temp_file_limit = '512MB';
```

- **A password of 32 random bytes**, stored as `scram-sha-256`
  (`password_encryption = scram-sha-256`).
- **`pg_hba.conf`: each role to its own database**, nothing else, from your
  trial networks only:
  `host  sameuser  all  10.20.0.0/16  scram-sha-256`.
- **`CONNECTION LIMIT`** on each role, so one trial cannot take every
  connection your server has.
- **`temp_file_limit`**, so one query cannot fill your disk with temporary
  files.
- **A disk quota per trial**: a tablespace on a volume with a quota, as
  above. Adminium's own size cap measures live data and is a courtesy; your
  quota is the limit.

### One network, one volume, one secret per trial

- **One Docker network per trial.** The container reaches your database
  server, your relay and the internet, never another trial's container.
- **A volume with a quota** for its data folder (`ADMINIUM_DATA_DIR`), for the
  same reason as the tablespace.
- **Its own random `ADMINIUM_SECRET`**, kept encrypted by your control service
  apart from the instance's archives. Two instances that share one accept each
  other's signed values. The same goes for **its own operator token** and
  **its own relay credential**: one leaked instance must not open another.

### Pass the variables through the Docker API

Build the container with the Docker Engine API's `Env` array, one string per
variable:

```json
{
  "Image": "ghcr.io/mosofi/adminium:<version>",
  "Env": [
    "NODE_ENV=production",
    "ADMINIUM_TRIAL_MODE=on",
    "ADMINIUM_TRIAL_ENDS_AT=2026-12-01T00:00:00Z",
    "ADMINIUM_PUBLIC_ORIGIN=https://hollis.try.example.com"
  ]
}
```

Never write an env file or a compose file from what a visitor typed (a name,
a company, a prompt): a line break in it adds a variable of their choosing.
The server refuses to start on a control character in any trial or operator
variable, and a start prompt goes in as base64
(`ADMINIUM_DESIGNER_START_PROMPT_B64`) or a read-only file, never as raw text.

### The proxy

- **Refuse `/api/v1/operator/*`** on every public name. The public listener
  answers it with `404` anyway:
  [Refuse the operator paths](/self-hosting/reverse-proxy/#refuse-the-operator-paths).
- **Keep query strings of the setup path out of your logs**:
  [the setup token in your logs](/self-hosting/reverse-proxy/#keep-the-setup-token-out-of-your-logs).
- **Pass the host name the visitor asked for** (`Host`, or
  `X-Forwarded-Host` with `ADMINIUM_TRUST_PROXY=on`). The instance answers
  `421` on any name but its own, and without the trusted proxy every sign-in
  in its audit log and your events comes from the proxy's address.

### The relay

The instance sends every mail through `ADMINIUM_TRIAL_SMTP_URL`, from
`ADMINIUM_TRIAL_MAIL_FROM`, and counts its own caps. Those caps are a courtesy.
Your relay holds the real ones:

- **pin the envelope and header From** to the address of the credential, so
  a trial cannot send as anybody else;
- **cap each instance and each account**: at least the user cap
  (`ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY`, 20 an hour, 20 different people a day,
  at most 5 recipients a message) plus 50 account emails a day;
- report bounces and spam complaints back, so the instance holds its mail.

### The Supabase hand-off and the Upgrade page

- **Your connect service** sends the browser back to the origin you
  registered for the instance, never to the `instance` parameter it was given:
  [What your service must do](#8-connect-supabase).
- **Your Upgrade page** is opened as
  `ADMINIUM_TRIAL_UPGRADE_URL?instance=<ADMINIUM_PUBLIC_ORIGIN>`, in the same
  tab. Anyone can edit that parameter, so read it as a hint: decide which
  instance to upgrade from the account signed in to your page.

## 12. A paid installation: the hosted profile

`ADMINIUM_HOSTED_MODE=on` is for an installation somebody pays you for, on your
server: usually a trial after its Upgrade. Its Super Admin is still somebody
else on your machine and your network, so the profile keeps every switch above
that guards them, and drops what only limits a free trial: the table's
**Hosted** column. In short:

- **Kept**: only your database hosts and the one login, `strict`, no SQLite,
  files in the data folder only, no uploads of add-ons or apps, a Designer that
  never writes code, the project's `.env` not read, its own addresses only, the
  operator endpoint and the hide switch.
- **Dropped**: the end date, the banners and the Upgrade button, the size caps
  and the pools of 3, `noindex`, mail only through your relay (they set their
  own mail server), and the outgoing calls: webhooks, add-on calls, payments,
  telemetry and the update check come back. Your own quotas on the database
  server and the volume stay yours to set.

It needs `ADMINIUM_PUBLIC_ORIGIN` and `ADMINIUM_DATABASE_HOSTS`, refuses the
same contradicting values as a trial (except telemetry, maps and routing,
which become theirs), and needs no end date and no setup token. It does not
hide **Put this online…** for you: set `ADMINIUM_DEPLOY_LINK=off` as well.

### The Upgrade

Recreate the container on the same meta store, the same data folder and the
same `ADMINIUM_SECRET`, with `ADMINIUM_HOSTED_MODE=on` in place of
`ADMINIUM_TRIAL_MODE=on`:

1. **Remove every `ADMINIUM_TRIAL_*` variable**, the relay included. A hosted
   boot with one left fails and names it, so no old end date or relay carries
   over.
2. **Keep** `ADMINIUM_PUBLIC_ORIGIN`, `ADMINIUM_DATABASE_HOSTS`,
   `ADMINIUM_SOURCE_URL`, `ADMINIUM_OPERATOR_DOMAINS`, the operator endpoint's
   variables and `ADMINIUM_DEPLOY_LINK`. Raise `ADMINIUM_SOURCE_POOL_MAX` and
   the role's `CONNECTION LIMIT` if you like.
3. **Everything in the meta store comes along**: people, pages, connections,
   settings, mapped domains. The end date and the size caps were never stored,
   so the installation takes writes again from its first request.

A hide you set on the public pages stays until you lift it. Telemetry and the
update check stay off until the Super Admin switches them on, and no mail goes
out until they set their own mail server. Keep `ADMINIUM_AI_OPERATOR_ONLY=on`
if AI should still run on your connection only.

## 13. All together

On a server you run for a client you know (sections 1 to 9):

```bash
NODE_ENV=production
ADMINIUM_SECRET_FILE=/run/secrets/adminium_secret   # its own, per instance; or ADMINIUM_SECRET=…
ADMINIUM_SETUP_TOKEN_FILE=/run/secrets/setup_token  # or read the one the log prints
ADMINIUM_DATABASE_HOSTS=localhost:5432
ADMINIUM_LOCAL_DATABASES=off
ADMINIUM_NETWORK_POLICY=strict
ADMINIUM_SQLITE_DIRS=/srv/client/databases
ADMINIUM_STORAGE_DIRS=/srv/client/files
ADMINIUM_DEPLOY_LINK=off              # if you host it yourself
ADMINIUM_SUPABASE_CONNECT_URL=https://connect.example.com/supabase   # if you run a connect service
ADMINIUM_OPERATOR_TOKEN_FILE=/run/secrets/operator_token   # with the next line: the operator endpoint
ADMINIUM_OPERATOR_LISTEN=10.0.0.2:4601
```

None of these limits what a super admin can do inside Adminium itself: roles,
pages and data stay theirs. They limit what the server does on your machine and
your network on their behalf. They are yours as the operator: set them where
the server is started (the service file, the container's environment, the
host's settings). On such a server a project's `.env` is read too, after them,
and fills in whatever they leave unset, so whoever can write that file on your
server can set these limits as well; keep it yours. The names a project's
`.env` (or its config) can never set are `ADMINIUM_RUNTIME`, the two profile
switches `ADMINIUM_TRIAL_MODE` and `ADMINIUM_HOSTED_MODE`, and every other
`ADMINIUM_TRIAL_*` variable: the server ignores them there and says so. (The desktop app, which opens folders it did not make, ignores every
one of these names in a folder's `.env`, and so do trial mode and the hosted
profile, which do not read it at all.)

A trial for a stranger (sections 10 and 11), as the `Env` array of its
container, one value per instance where it says so:

```json
[
  "NODE_ENV=production",
  "ADMINIUM_SECRET_FILE=/run/secrets/adminium_secret",
  "ADMINIUM_TRIAL_MODE=on",
  "ADMINIUM_TRIAL_ENDS_AT=2026-12-01T00:00:00Z",
  "ADMINIUM_SETUP_TOKEN=3f9c0a7d5e21b8c64a90d3e7f1b2c5a8",
  "ADMINIUM_PUBLIC_ORIGIN=https://hollis.try.example.com",
  "ADMINIUM_DATABASE_HOSTS=pg-trials:5432,*.pooler.supabase.com:5432,*.pooler.supabase.com:6543,*.supabase.co:5432",
  "ADMINIUM_SOURCE_URL=postgres://trial_7f3a9c:…@pg-trials:5432/trial_7f3a9c",
  "ADMINIUM_TRIAL_SMTP_URL_FILE=/run/secrets/relay_url",
  "ADMINIUM_TRIAL_MAIL_FROM=i-7f3a9c@relay.example.com",
  "ADMINIUM_OPERATOR_NAME=Example Hosting",
  "ADMINIUM_TRIAL_UPGRADE_URL=https://example.com/upgrade",
  "ADMINIUM_TRUST_PROXY=on",
  "ADMINIUM_DEPLOY_LINK=off",
  "ADMINIUM_OPERATOR_TOKEN_FILE=/run/secrets/operator_token",
  "ADMINIUM_OPERATOR_LISTEN=10.20.7.2:4601",
  "ADMINIUM_OPERATOR_EVENTS_URL=https://control.example.com/instance-events"
]
```

Then work through the [security checklist](/self-hosting/security/#the-checklist).

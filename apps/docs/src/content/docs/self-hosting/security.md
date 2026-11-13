---
title: Security hardening
description: The secret, the database role, network exposure, and the settings worth checking before Adminium faces a team.
sidebar:
  order: 7
---

Adminium is an admin panel: by construction it is a tool that can read — and
often write — your production data. Treat it as production infrastructure.

## The checklist

- [ ] `ADMINIUM_SECRET` is random, ≥ 32 bytes, in a secret manager, backed up
- [ ] You created the first account yourself, with the setup token from the
      log, before anyone else reached the address
- [ ] The database role is the narrowest one that does the job
- [ ] TLS in front, `ADMINIUM_TRUST_PROXY=on`, port not otherwise reachable
- [ ] The meta store is not published to the internet
- [ ] Roles are assigned per person; nobody is a super admin by default
- [ ] 2FA on for anyone who can write
- [ ] `ADMINIUM_CORS_ORIGINS` unset (unless you genuinely split the deployment)
- [ ] `ADMINIUM_BRIDGE_ORIGINS` unset on a server — it exists for a laptop being
      set up from adminium.dev, and a production instance has no such moment
- [ ] Audit log reviewed periodically
- [ ] People who sign in but do not run the server? `ADMINIUM_NETWORK_POLICY=strict`
      (see [What Adminium may call](#what-adminium-may-call)), and the rest of
      [Run Adminium for other people](/self-hosting/for-other-people/)

## `ADMINIUM_SECRET`

```bash
openssl rand -hex 32
```

It derives the AES-256-GCM key that encrypts every stored DSN and provider API
key at rest, and it signs the session cookie.

- **Keep it out of the image.** It arrives via the environment at run time. The
  image ships only code.
- **Keep it out of your shell history and your repo.** A secret manager, or a
  file mode 600 that your process reads.
- **Back it up.** A meta-store backup without the secret is a file of
  ciphertext.
- **Do not rotate it casually.** Rotation invalidates every stored secret; they
  must be re-entered by hand.

### Out of reach once the server has started

At boot Adminium reads `ADMINIUM_SECRET`, `ADMINIUM_SETUP_TOKEN`,
`ADMINIUM_ARCHIVE_KEY`, every `ADMINIUM_AI_*` variable, `ADMINIUM_FIGMA_TOKEN`,
the picture sites' keys (`PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`,
`PIXABAY_API_KEY`) and the operator's own keys into the parts of the server
that use them, then **deletes them from `process.env`**, before a project's
config, hooks or actions are loaded. Every program the server starts (an app's
tests, an app's own build line, a package install, git, the browser) is given
a short, named environment instead of a copy of its own: where programs are,
the home and temporary folders, the language, Windows' own settings, and for
package installs the `npm_config_*` and proxy settings (never one holding a
token or a password). So none of those values is in `process.env` or in any of
those programs' environments. A hook or a project config that read
`process.env.ADMINIUM_SECRET`, or a model key, after the server started now
reads nothing. Give such code a variable of its own.

What deleting cannot do: the operating system keeps the environment a process
**started** with, and shows it to any code running as the same user
(`/proc/<pid>/environ` on Linux, `ps eww` on macOS). A hook, or a program the
server started, can still read a secret there if you gave it as a plain
variable. To close that, give the secrets as files: set
`ADMINIUM_SECRET_FILE=/run/secrets/adminium_secret` instead of
`ADMINIUM_SECRET`, and the same `_FILE` ending for every name above. This is
what Docker and Kubernetes secrets hand you. The value is then never in any
environment, and the `_FILE` variable is deleted from `process.env` too.
Plain variables keep working, but stay readable that way.
([Secrets from files](/self-hosting/env-vars/#secrets-from-files-_file))

## The setup token

A fresh instance has no account. Whoever finishes the first-run wizard first
becomes its super admin. On a one-click host (Railway, Render, Fly.io, a
Droplet on a public IP) there are a few minutes between the deploy finishing
and you opening the address, and anyone who finds it in that window could take
the instance.

So a server asks for a **setup token** first. Adminium prints it in its log
every time it starts, until the first account exists:

```
Adminium is running at http://localhost:4600

Setup token: K7QD-9MXR-2FTB-WH4N
The first-run wizard asks for it before it creates the first account.
```

Copy it from wherever your host shows the log (`docker logs <container>`,
`docker compose logs adminium`, `journalctl -u adminium`, the host's log
viewer) and paste it into the wizard's first screen. Case, spaces and dashes
don't matter.

- **One account, then gone.** The token is checked and deleted in the same
  database transaction that creates the first account. After that, nothing is
  printed and setup answers "already set up" whatever is sent.
- **Not stored.** Adminium keeps a salted hash, never the token. The printed
  token is derived from `ADMINIUM_SECRET`, so a restart prints the same one;
  change the secret before setup and a new one is printed.
- **Choose your own** with `ADMINIUM_SETUP_TOKEN` (at least 16 characters). A
  deploy template can generate one and show it beside the other variables;
  Adminium then logs that the token is the variable's value, not the value.
- **What it guards.** Creating the first account, and the two other things the
  wizard can do before one exists: checking a database for an existing
  Adminium store (`/setup/probe`) and adopting one (`/setup/adopt`). A wrong
  token is a 403, audited as `setup_token_denied`, and shares the sign-in rate
  limit (5 tries a minute per address).
- **Where it is not asked.** The desktop app, and `adminium dev`, `design` and
  `try` while they listen on this computer only (`127.0.0.1`). `try` on every
  address (its default) asks, but hands the token to the browser it opens, so
  you only type it from another device. That link reaches the program that
  opens your browser (`open`, `xdg-open`, `start`) on its command line, where
  other accounts on the same computer can see it while that program runs;
  `try` is meant for your own computer, so that is accepted. `adminium start`
  always asks, even on `127.0.0.1`, because behind a reverse proxy that
  address is public.
- **Decided when the server starts, not by what the store holds.** A server
  that asks keeps asking even if something else serving the same meta store
  (`adminium dev` on the same folder, say) never asked: with its proof missing,
  every setup call is refused until the server is restarted, never let
  through. A restart onto a moved or adopted store puts a token in that store
  and prints it again.
- **Kept out of logs.** A link that hands the token over carries it after a
  `#` (`/setup#setup-token=…`), which a browser never sends to a server or a
  proxy; the wizard reads it and removes it from the address bar. The setup
  pages and calls answer with `Referrer-Policy: no-referrer`, so they never
  tell another site where you came from.

## The database role is the real boundary

Adminium's RBAC governs what users can do **through Adminium**. The database
role governs what Adminium can do at all. Only the second one holds if Adminium
itself is compromised.

Give it the narrowest role that does the job:

```sql
-- Read everything, write only what actually needs editing.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO adminium;
GRANT INSERT, UPDATE, DELETE ON support_tickets, refunds TO adminium;
```

Adminium probes per-table capabilities and generates accordingly — `orders`
renders read-only, `refunds` gets a Save button. The UI reflects the grant
rather than the grant reflecting the UI.

Do not connect as a superuser because it is easier. It is easier.

## Network exposure

```bash
HOST=127.0.0.1 ADMINIUM_TRUST_PROXY=on adminium start
```

Bind loopback, put TLS in front. Under Docker, `expose` the port to the compose
network rather than `ports`-publishing it to the host.

`ADMINIUM_TRUST_PROXY=on` while the port is directly reachable is worse than
leaving it off — it lets any client forge `X-Forwarded-For` and appear in your
audit log as whatever it likes. The two settings are a pair.

→ [Behind a reverse proxy](/self-hosting/reverse-proxy/)

## What Adminium may call

Three addresses are typed by people who sign in, not by you: a source
database's host, an automation's webhook URL, and an S3 or WebDAV storage
endpoint. Each is looked up before it is connected to (a storage host at least
once a minute while its connections stay open), every address it gives is
checked, and the connection goes to an address that was checked, so a name
cannot point somewhere else a moment later.

- **Cloud metadata** (`169.254.169.254` and its other spellings,
  `metadata.google.internal`, Alibaba's and Oracle's addresses) is refused
  always. It is where a cloud server's own credentials live.
- **This machine** (`localhost`, `127.0.0.1`, `::1`) is refused in production.
  A database on the same server is allowed by name with
  [`ADMINIUM_DATABASE_HOSTS`](/self-hosting/env-vars/#adminium_database_hosts),
  or by a super admin's **Allow databases on this server** switch, which
  [`ADMINIUM_LOCAL_DATABASES=off`](/self-hosting/env-vars/#adminium_local_databases)
  locks off.
- **The server's own network** (`10.x`, `172.16–31.x`, `192.168.x`,
  `100.64–127.x`, IPv6 `fc00::/7`) is allowed by default, because a database or
  MinIO next to Adminium is the normal case. Set
  [`ADMINIUM_NETWORK_POLICY=strict`](/self-hosting/env-vars/#adminium_network_policy)
  when the people who sign in should not reach the other machines on that
  network. Under `strict`, `ADMINIUM_DATABASE_HOSTS` still lets the databases
  you name through; webhooks and storage get no exceptions.
- **A name that does not resolve** is never called; the error says
  `Could not look up <host>` (status 502), apart from a refusal (422).

A `local` storage destination names a folder on the server; Adminium's own
folders (its data directory, backups, the meta store) are refused, and
[`ADMINIUM_STORAGE_DIRS`](/self-hosting/env-vars/#adminium_storage_dirs) pins
the folders allowed. SQLite sources follow the same rule with
[`ADMINIUM_SQLITE_DIRS`](/self-hosting/env-vars/#adminium_sqlite_dirs).

## The meta store

It holds your users, your password hashes, your encrypted DSNs, and your audit
log. It should be reachable from Adminium and nothing else — not published, not
on a public IP, not sharing credentials with anything.

The shipped compose file gets this right: `meta-db` uses `expose`, not `ports`.

When you move the meta store from the setup wizard or Studio, the connection
string you type is checked like a source database's: no query parameter that
names another host or a socket (`?host=`, `?hostaddr=`, `?socketPath=`), and
never a cloud metadata address, whether it is typed or a name answers with
one. A name that does not resolve gets `Could not look up <host>` (502). A
database on this server (`localhost`) or on the server's own network is fine. A SQLite file chosen there must be inside `ADMINIUM_DATA_DIR`, written
without `..`, and not through a link that leads out of it. To keep the store
anywhere else, set `ADMINIUM_META_URL`; that value is yours, and at each start
only its host is checked: one that is, or resolves to, a cloud metadata
address stops the boot. (In trial mode and the hosted profile it must also
pass every check a typed one does: [trial mode](/self-hosting/for-other-people/#databases-the-host-list-and-one-login).)

## Accounts

- **Passwords** are hashed with argon2id.
- **2FA (TOTP)** is available. Turn it on for anyone who can write.
- **Roles**: assign the narrowest one. Super admin is for people who administer
  Adminium, not for everyone who uses it.
- **API keys** are scoped and revocable. Issue one per integration, never share
  one between two, and revoke on rotation.
- **Several businesses on one server.** Grouping their databases into
  workspaces sorts the menu; it does not separate who sees what. Roles do. Give
  each business roles with grants on its own databases only, and keep server-wide
  rights (refunds, privacy, the audit log, exports) to people trusted with every
  business. See [Workspaces](/guides/workspaces/).

## What is already on

You do not need to configure these; they are worth knowing:

| | |
|---|---|
| Encryption at rest | AES-256-GCM for stored DSNs and provider keys |
| Password hashing | argon2id |
| Session cookie | httpOnly, signed, `SameSite=Lax`, `Secure` over HTTPS |
| CORS | **Off** — same-origin by default |
| Loopback DSN guard | Blocks connecting to `localhost` from a hosted instance, except the database hosts you name in [`ADMINIUM_DATABASE_HOSTS`](/self-hosting/env-vars/#adminium_database_hosts). Every spelling of the machine counts (`localhost.`, `127.1`, `0.0.0.0`, `::ffff:127.0.0.1`), and a database's host name is looked up before each new connection pool and checked again for each new connection (one lookup serves five seconds of them, so a failover is followed without a restart): a name that points at the machine itself or at a cloud metadata address, or does not resolve at all, is refused, and the driver connects only to the addresses that were checked |
| PII masking | **On by default** for columns classified as personal |
| Telemetry | **Off** |
| Input validation | Every external input is schema-validated, fail-fast |

## PII masking

Introspection classifies columns and proposes masks for anything that looks
personal. The default is masked. Review the proposals rather than bulk-accepting
the unmask — the default exists because "we did not think about it" should fail
closed.

Who reads masked columns in clear is a permission per table: **See personal data** on a table, or
**Manage database connections** for every table. See
[Personal data](/guides/apps/roles-and-staff-access/#personal-data).

## The audit log

Every mutation is recorded: who, what, when, before, after. It is only worth
having if someone reads it. Review it periodically, and remember it lives in the
meta store — which is one more reason the meta store should not share a fate
with the database being audited.

→ [Where to put the meta store](/self-hosting/meta-store/)

## Reporting a vulnerability

See `SECURITY.md` in the repository. Please do not open a public issue for a
security report.

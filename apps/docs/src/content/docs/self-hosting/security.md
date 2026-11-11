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

At boot Adminium reads `ADMINIUM_SECRET`, `ADMINIUM_SETUP_TOKEN`, every
`ADMINIUM_AI_*` variable and the operator's own keys into the parts of the
server that use them, then **deletes them from the process environment**. A
project's hooks and actions run inside the server, and every program it starts
(an app's tests, an app's own build line, a package install, git, the
browser) inherits that environment, so none of them can read those values. Each
of those programs is given a short, named environment instead: where programs
are, the home and temporary folders, the language, and for package installs
the `npm_config_*` and proxy settings (never one holding a token or a
password). A hook or a project config that read `process.env.ADMINIUM_SECRET`,
or a model key, after the server started now reads nothing. Give such code a
variable of its own.

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
  you only type it from another device. `adminium start` always asks, even on
  `127.0.0.1`, because behind a reverse proxy that address is public.
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

## The meta store

It holds your users, your password hashes, your encrypted DSNs, and your audit
log. It should be reachable from Adminium and nothing else — not published, not
on a public IP, not sharing credentials with anything.

The shipped compose file gets this right: `meta-db` uses `expose`, not `ports`.

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
| Loopback DSN guard | Blocks connecting to `localhost` from a hosted instance |
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

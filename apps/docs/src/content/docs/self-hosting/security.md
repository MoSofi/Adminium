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
      (see [What Adminium may call](#what-adminium-may-call))

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
endpoint. Each is looked up before every connection, every address it gives is
checked, and the connection goes to the address that was checked, so a name
cannot point somewhere else a moment later.

- **Cloud metadata** (`169.254.169.254` and its other spellings,
  `metadata.google.internal`, Alibaba's and Oracle's addresses) is refused
  always. It is where a cloud server's own credentials live.
- **This machine** (`localhost`, `127.0.0.1`, `::1`) is refused in production.
  A database on the same server is allowed by name with
  [`ADMINIUM_DATABASE_HOSTS`](/self-hosting/env-vars/#adminium_database_hosts).
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
| Loopback DSN guard | Blocks connecting to `localhost` from a hosted instance, except the database hosts you name in [`ADMINIUM_DATABASE_HOSTS`](/self-hosting/env-vars/#adminium_database_hosts). Every spelling of the machine counts (`localhost.`, `127.1`, `0.0.0.0`, `::ffff:127.0.0.1`), and a database's host name is looked up before each new connection pool: a name that points at the machine itself or at a cloud metadata address, or does not resolve at all, is refused, and the driver connects only to the addresses that were checked |
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

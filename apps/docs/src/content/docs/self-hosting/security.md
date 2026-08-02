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

## `ADMINIUM_SECRET`

```bash
openssl rand -hex 32
```

It derives the AES-256-GCM key that encrypts every stored DSN and provider API
key at rest, plus the session HMAC key and the CSRF key.

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

## What is already on

You do not need to configure these; they are worth knowing:

| | |
|---|---|
| Encryption at rest | AES-256-GCM for stored DSNs and provider keys |
| Password hashing | argon2id |
| CSRF protection | On |
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

## The audit log

Every mutation is recorded: who, what, when, before, after. It is only worth
having if someone reads it. Review it periodically, and remember it lives in the
meta store — which is one more reason the meta store should not share a fate
with the database being audited.

→ [Where to put the meta store](/self-hosting/meta-store/)

## Reporting a vulnerability

See `SECURITY.md` in the repository. Please do not open a public issue for a
security report.

---
title: Run Adminium for other people
description: The settings that matter when you run the server and somebody else signs in as its super admin, for an agency, a school or a client.
sidebar:
  order: 8
---

This page is for you if you run the server and somebody else uses it: a client
of your agency, a class, a team you set Adminium up for. They sign in as a super
admin and can connect databases, add storage and write automations. You keep
the machine, its network, its other services and its secrets.

Out of the box Adminium assumes the person who signs in also runs the server.
The settings below draw the line between the two of you. Each one has its own
section elsewhere in these docs; this page says which ones to set and why.

## 1. Create the first account before anyone else can

A fresh server asks for a one-time **setup token** before it creates the first
account, and prints the token in its log. Nobody who only finds the address can
take the instance. Either create the first account yourself and invite your
client, or hand them the token (or a link to
`https://<your address>/setup#setup-token=<token>`) by a channel you trust.

Set your own token with `ADMINIUM_SETUP_TOKEN` when your deploy tool can
generate one, so you never have to read the log.

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
`ADMINIUM_DATABASE_HOSTS` still pass.

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
**Allow databases on this server** never travels in either file. When each
instance has its own secret, set the same `ADMINIUM_ARCHIVE_KEY` on both
servers.

Your client can download **Export everything** from Studio themselves. On a
server without a terminal, `adminium import-zip` needs `--owner <email>` when
the file holds more than one super admin.

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
   instance's origin), `state` and `challenge` (`base64url(SHA-256(verifier))`,
   no padding, as in PKCE's S256). After the sign-in, send the browser to
   `<origin>/connect/supabase/return?state=<state>&code=<code>`, where
   `<origin>` is **the origin you registered for that instance**. Never send it
   to the `instance` parameter as given: that would make your page an open
   redirect. Make `code` random, single use, short-lived (a minute is plenty),
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

The host must still pass this server's own rules for databases. Under
`ADMINIUM_NETWORK_POLICY=strict` or behind your own firewall, Supabase's hosts
are public addresses and pass; list your own database hosts in
`ADMINIUM_DATABASE_HOSTS` as for any other connection.

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

## 10. A paid installation on your server: the hosted profile

If you run trials for strangers (`ADMINIUM_TRIAL_MODE=on`) and one of them
pays, recreate their container with `ADMINIUM_HOSTED_MODE=on` instead. The
person is still somebody else on your server, so the hosted profile keeps every
rule that guards your machine and your network: only your database hosts and
the login you gave them, `strict`, files in the data folder, no add-on or app
uploads, a Designer that builds with the manifest and never writes code, your
addresses and your domains only, the operator endpoint. It drops what only
limits a free trial: the end date, the banners, the size caps, `noindex`, and
mail through your relay (they set their own mail server). Their project's `.env`
is not read, under either profile.

Keep the same meta store, data folder and `ADMINIUM_SECRET`, and remove every
`ADMINIUM_TRIAL_*` variable: a hosted boot with one left fails and names it.

→ [The hosted profile](/self-hosting/env-vars/#the-hosted-profile) ·
[Trial mode and the hosted profile](/self-hosting/env-vars/#trial-mode-and-the-hosted-profile)

## All together

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
host's settings). A project's `.env` is read too, after them, and fills in
whatever they leave unset, so whoever can write that file on your server can
set these limits as well; keep it yours. The one name a project's `.env` can
never set is `ADMINIUM_RUNTIME`: the server ignores it there and says so. (The
desktop app, which opens folders it did not make, ignores every one of these
names in a folder's `.env`.)

Then work through the [security checklist](/self-hosting/security/#the-checklist).

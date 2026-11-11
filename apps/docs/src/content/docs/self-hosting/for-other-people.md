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

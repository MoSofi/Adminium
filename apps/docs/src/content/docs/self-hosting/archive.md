---
title: Back up and move an instance
description: adminium archive create writes a whole instance into one signed file; adminium archive restore brings it back on another server, on any meta-store engine.
sidebar:
  order: 10
---

```bash
adminium archive create ./adminium-archive.zip
```

One file holds the whole instance, as far as one file can:

| In the archive | Not in the archive |
|---|---|
| The meta store: people (with their password hashes), roles, pages, settings, apps' rows of configuration, audit log. From SQLite, Postgres or MySQL; it restores into any of the three. | Adminium itself. Install the same or a newer version on the new server. |
| Uploads kept on this server's disk (`<data dir>/files` and every `local` storage destination) | Uploads in S3 or WebDAV: they stay where they are, and the restored instance reads them there. |
| Local SQLite databases you connected, copied safely while the server runs | Databases on other hosts. Back those up with their own tools (`pg_dump`, `mysqldump`). |
| The project folder: Designer-built apps, sides and sites, pages, lists | The project's `.env`, its `.adminium/` folder and `node_modules/`. Copy `.env` yourself if you need it. |
| A list of installed catalog apps and add-ons with their versions | The packages themselves: after a restore they show as **Missing** in Studio until you download them again, and each is checked again when it is. |
| Secrets (connection strings, mail and AI keys), still encrypted with `ADMINIUM_SECRET` | Sessions, password-reset and invitation links, add-on trust, the Designer's live switch, and **Allow databases on this server**. |

The file holds password hashes and encrypted secrets: keep it as safe as the server.

## Restore on another server

Restore into a **fresh** instance, before its first start: an empty data dir,
and an empty database if the meta store is Postgres or MySQL. An instance that
already has people in it is refused; there is no flag to merge two instances.

```bash
export ADMINIUM_SECRET=…        # the same secret the old server had
export ADMINIUM_DATA_DIR=/var/lib/adminium
export ADMINIUM_META_URL=postgres://adminium:…@db:5432/adminium   # optional
adminium archive restore ./adminium-archive.zip --project-dir /srv/my-project
adminium start
```

The restore migrates the empty store to the archive's version, loads it, and
migrates the rest of the way, so an archive from an older Adminium restores
into a newer one. An archive from a newer Adminium is refused.

Try it first with `--dry-run`: it checks the signature, every file and every
row, and writes nothing.

After the restore:

- Everyone signs in again; no session survives. Passwords are unchanged.
- API keys are dropped. Pass `--keep-api-keys` to keep them.
- Connection strings, storage addresses and app domains are checked again, as if
  they were typed in. One that fails (a database on `localhost` in production,
  say) is switched off and named; enter it again in Studio. S3 and WebDAV
  addresses are looked up on the new server and follow its
  [`ADMINIUM_NETWORK_POLICY`](/self-hosting/env-vars/#adminium_network_policy);
  `local` folders follow its
  [`ADMINIUM_STORAGE_DIRS`](/self-hosting/env-vars/#adminium_storage_dirs).
- Local SQLite databases land in `<data dir>/databases/`, and their connections
  point there.
- Download catalog apps and add-ons again from Studio → Add-ons.
- Switch the Designer on again if you use it.

## The signature, and `ADMINIUM_ARCHIVE_KEY`

Every archive is signed, and a restore refuses one that is unsigned or was
changed after it was made. By default the key is made from `ADMINIUM_SECRET`, so
moving a server needs nothing new: you carry the secret anyway, or no encrypted
connection string would open.

Set `ADMINIUM_ARCHIVE_KEY` (at least 32 characters, the same on every server)
when each instance has its own secret, or when you may need to restore without
the old one. Then:

```bash
adminium archive restore ./adminium-archive.zip --drop-secrets
```

restores under a different `ADMINIUM_SECRET`: people, passwords, pages and files
come back, and every encrypted value is dropped. Enter connection strings, mail
and AI keys again. A restore under a different secret without `--drop-secrets`
is refused.

## Restore for evidence: `--hold`

```bash
adminium archive restore ./adminium-archive.zip --hold
```

Restores with mail off (the SMTP setting is not restored), the public API off,
every app's customer side switched off and the Designer off, to look at an
instance without running it. Public forms and `/x/` pages have no switch of their
own yet: keep a held instance off the public internet.

## Export everything

```bash
adminium archive create ./adminium-export.zip --export
adminium import-zip ./adminium-export.zip --project-dir ./my-project
```

The same contents without password hashes, secrets, API keys and tokens, and
unsigned: a file to hand to someone, or to move your work to a server you set up
from scratch. A Super Admin can also download it from Studio; see
[Export everything from Studio](/self-hosting/export-everything/), which also
says how the import gives you a password to sign in with.

Not the same as [`export-zip`](/self-hosting/export-zip/), which carries eight
configuration resources and none of your people, files or apps.

## From the desktop app

The desktop app's own backups (**File → Back up now…**) restore on the desktop
only. To move a desktop install to a server, run `adminium archive create`
against the desktop's data directory, then restore the archive on the server.

## Limits

- One archive holds up to 4 GB. Keep large uploads in an S3 or WebDAV
  destination, which an archive leaves where it is.
- A meta table with more than 500,000 rows (a long audit log) is refused; back
  such a meta store up with the database's own tools.

---
title: Upgrading
description: Forward-only meta migrations, the downgrade guard, and how to upgrade an Adminium instance without losing your afternoon.
sidebar:
  order: 6
---

Adminium's meta migrations are **forward-only**. There is no `down`. Read that
sentence again before you upgrade production.

## The short version

```bash
# 1. Back up the meta store. Not optional.
pg_dump adminium_meta > meta-backup-$(date +%F).sql

# 2. Upgrade.
docker compose pull && docker compose up -d
#   or, for a from-source install
git pull && pnpm install && pnpm build

# 3. Migrations apply on boot. Or apply them yourself first:
adminium migrate
```

## Back up first, and mean it

Forward-only means the migration is the only direction that exists. If an
upgrade goes wrong, your recovery path is **restore the backup**, not roll back
the schema.

```bash
# PostgreSQL meta store
pg_dump adminium_meta > meta-backup.sql

# MySQL
mysqldump adminium_meta > meta-backup.sql

# SQLite (embedded) — .backup, not cp: WAL means the file is not the database
sqlite3 "$ADMINIUM_DATA_DIR/meta.db" ".backup 'meta-backup.db'"
```

And back up `ADMINIUM_SECRET`, if it is not already somewhere safe. A meta-store
backup without the secret is a file full of ciphertext.

## Migrations apply on boot

`adminium start` applies pending migrations before it listens. So does the
container's default command. In most cases upgrading is: pull, restart, done.

To apply them yourself — the right move when you want the migration and the
restart to be separate events:

```bash
adminium migrate
```

```
Applied 3 migration(s) to the postgres meta store:
  0007_add_widget_layouts
  0008_audit_index
  0009_api_key_scopes
```

It is idempotent. A second run applies nothing, because the ledger says so:

```
Meta store is up to date (postgres).
```

Skip the boot-time migration when you have already run it:

```bash
adminium start --skip-migrate
```

## Look before you leap

```bash
adminium migrate --status
```

```
migration                 applied  note
0001_init                 yes
0002_connections          yes
0007_add_widget_layouts   no
```

Three notes can appear in that last column, and two of them are alarms.

## `CHECKSUM DRIFT`

A migration that already ran no longer matches what this version says it should
have been. The file changed after it was applied.

This is not something to force past. It means the schema Adminium believes it
has and the schema it actually has have diverged — usually because someone
edited a migration in place, or a partial restore mixed two versions. Restore
from backup and reapply cleanly.

## `unknown to this version`

The meta store contains a migration this build has never heard of — i.e. **the
store was written by a newer Adminium than the one you are running**. You
downgraded.

Adminium refuses rather than proceeding. It cannot un-apply a migration it does
not have, and running an old build against a new schema corrupts data quietly
rather than loudly.

The fix is to go back to the version you came from. If you genuinely need to
downgrade, restore the pre-upgrade backup — which is why step 1 is step 1.

## Pin your version

```bash title=".env"
ADMINIUM_VERSION=0.1.0
```

```bash
ADMINIUM_VERSION=0.5.1 docker compose up -d
```

`latest` is for evaluation. In production, pin, and upgrade deliberately — an
unattended `latest` means a `docker compose up` at an unrelated moment can
migrate your meta store as a side effect.

## Rehearse it

The meta store is a database like any other. Restore last night's backup
somewhere else, point a new Adminium at it, run the upgrade there first. This
takes ten minutes and is the difference between an upgrade and an incident.

## Your source database is untouched

Meta migrations only ever touch `adminium_*` tables. Upgrading Adminium never
migrates your data. Whether Adminium can write to your database at all is
decided by the role you gave it — see
[Read-only sources & the meta database](/guides/connect/read-only-and-meta/).

## See also

- [`adminium migrate`](/reference/cli/#migrate)
- [Where to put the meta store](/self-hosting/meta-store/)
- [Export & restore](/self-hosting/export-zip/) — which is *not* a backup

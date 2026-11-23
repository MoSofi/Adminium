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

For an npm install run by systemd, the same steps are in
[A VPS without Docker](/self-hosting/vps/#upgrading).

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

Adminium snapshots only the embedded SQLite meta store itself, to
`ADMINIUM_DATA_DIR/backups`, before it migrates. A PostgreSQL or MySQL meta
store gets no snapshot, so run `pg_dump` or `mysqldump` of the meta database
**before** you start the new version. The reminder Adminium prints on that
first start comes while the migrations are already running. Once they have
run, the older version refuses to start on that store, and your dump is the
only way back to it.

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
ADMINIUM_VERSION=0.3.72
```

```bash
ADMINIUM_VERSION=0.5.1 docker compose up -d
```

`latest` is for evaluation. In production, pin, and upgrade deliberately — an
unattended `latest` means a `docker compose up` at an unrelated moment can
migrate your meta store as a side effect.

The same applies to npm. `npx @adminiumjs/adminium start` with no version in
the spec installs any newer release it finds, without asking when no terminal is
attached, and `start` then migrates the meta store. On a server, install an
exact version into a fixed directory and move it yourself:
[A VPS without Docker](/self-hosting/vps/#upgrading).

A [project](/projects/) already pins one exact version, in its `package.json`
and in its `Dockerfile`'s image tag. Move both together — `npm run check`
compares them — and read
[Upgrading Adminium](/projects/deploy/#upgrading-adminium).

## Settings a release stops taking

A release sometimes refuses a setting an earlier one took, when the setting
could send Adminium somewhere it should not go. The setting is kept, but what
depends on it stops working until you change it. After an upgrade to 0.3.72,
check three things:

- **Database connection strings.** A string that carries a parameter the
  release refuses (`?host=`, `?port=`, `?sslrootcert=`, `?socketPath=` and
  others) stops connecting, and the error names the parameter. In production a
  string must also name a host. Edit the connection and take the parameter
  out: see [PostgreSQL](/guides/connect/postgres/#connection-string) and
  [MySQL](/guides/connect/mysql/#connection-string).
- **S3 and WebDAV storage.** A destination whose endpoint answers with a
  redirect fails its test and every read and write. Set it to the address it
  redirects to: see
  [An endpoint that redirects](/guides/files/storage-destinations/#an-endpoint-that-redirects).
- **The developer's add-on list.** `ADMINIUM_ADD_ON_DEV_TRUST` is now
  read only with `NODE_ENV` set to `test` or `development`. Left set on a
  server whose `NODE_ENV` is unset or says anything else, such as an npm
  install run as a service, it stops the server from starting, and the error
  names it. Remove it: see
  [`ADMINIUM_ADD_ON_DEV_TRUST`](/self-hosting/env-vars/#adminium_add_on_dev_trust). The Docker image sets
  `NODE_ENV=production`, which ignores it.

Rehearsing the upgrade (below) shows all three before production does.

## Keep read notifications longer

Every day at 03:00 UTC, Adminium permanently deletes notifications that were
read more than `retention.notificationsDays` ago (90 days by default). Unread
notifications stay until someone reads them. The setting has no screen yet, so
to keep read notifications longer, write it to the meta store. This keeps them
for 3650 days. Run the one that matches your meta store, **before** you upgrade
to a release that starts this cleanup, or at the latest before its first 03:00
UTC.

Embedded SQLite in the Docker image, which has no `sqlite3` command:

```bash
docker compose exec -T adminium node - <<'JS'
const Database = require('better-sqlite3');
const db = new Database(`${process.env.ADMINIUM_DATA_DIR}/meta.db`);
db.prepare(`INSERT INTO adminium_settings (key, value, updated_at)
  VALUES ('retention.notificationsDays', '3650', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run();
db.close();
JS
```

Embedded SQLite anywhere else:

```bash
sqlite3 "$ADMINIUM_DATA_DIR/meta.db" <<'SQL'
INSERT INTO adminium_settings (key, value, updated_at)
VALUES ('retention.notificationsDays', '3650', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
SQL
```

PostgreSQL:

```bash
psql "$ADMINIUM_META_URL" <<'SQL'
INSERT INTO adminium_settings (key, value, updated_at)
VALUES ('retention.notificationsDays', '3650', (extract(epoch FROM now()) * 1000)::bigint)
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
SQL
```

MySQL:

```bash
mysql adminium_meta <<'SQL'
INSERT INTO adminium_settings (`key`, value, updated_at)
VALUES ('retention.notificationsDays', '3650', UNIX_TIMESTAMP() * 1000)
ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at);
SQL
```

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

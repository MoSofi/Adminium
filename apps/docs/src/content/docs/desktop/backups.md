---
title: Backups & restore
description: What the desktop app backs up automatically, how to take one by hand, and what a restore does to your current data.
---

The desktop app takes backups on its own and keeps the last few. You can also
take one whenever you want, and restoring never deletes what you already have.

## Automatic

On by default, keeping **7** rotations in `<dataDir>/backups/`.

It runs daily at 03:00 **local** time — not UTC, because the whole point of the
hour is that you are asleep — and then waits for the first moment you are not
using the machine. If no idle moment turns up within four hours it backs up
anyway: waiting is a courtesy, not a precondition. A tick that finds nobody
signed in is skipped silently and retried tomorrow, because the archive is
written through the server as a real user (see [By hand](#by-hand)) and 03:00 is
not the time to put a login prompt on screen.

A backup is a zip containing the meta store, every local SQLite database, and a
manifest recording the app version, the meta-store migration version, and a
checksum for each file. Live databases are snapshotted with SQLite's online
backup API, so nothing is locked and nothing is half-written.

:::note[There is no setting for this in the app yet]
`autoBackup.enabled` and `autoBackup.keep` live in `config.json` (the table
under [What is *not* in the archive](#what-is-not-in-the-archive) says where
that file is), and **Settings → Desktop** carries no backup control — it holds
the Sign-in, Share-on-local-network and App-permissions cards and nothing else.
To change the rotation depth or turn auto-backup off, edit the file and
relaunch: the config is read once at startup, so an edit made while the app is
running is ignored and will be overwritten. `keep` accepts a whole number from
1 to 365; the app refuses to start on anything else rather than guessing.

**File → Back up now…** is unaffected either way, and so is
[restoring](#restoring).
:::

## By hand

**File → Back up now…** opens a save dialog and writes the same archive wherever
you point it.

The backup runs as the signed-in user, through the server, which is deliberate:
the archive contains every row in the install, so it belongs to a person the
audit log can name. With no session there is no backup — which is the right
answer for a file like that.

## What is *not* in the archive

`ADMINIUM_SECRET`. It lives in `config.json` next to the app, never in the zip.

That is a security decision with a consequence you have to know about: **a backup
alone cannot be restored onto a machine that does not have your secret.** Every
saved connection string and LLM key inside it is encrypted with that secret. If
you are moving to a new machine, or restoring after a disk failure, copy
`config.json` too — or at minimum record the secret somewhere safe.

| | Where `config.json` is |
|---|---|
| macOS | `~/Library/Application Support/Adminium/config.json` |
| Windows | `%APPDATA%\Adminium\config.json` |
| Linux | `~/.config/Adminium/config.json` |

## Restoring

**File → Restore from backup…**, pick an archive.

Before anything is touched, Adminium validates the manifest and every checksum.
An archive written by a **newer** version of the app is refused rather than
opened leniently — reading it with an older schema would drop what it does not
understand and write the result back as truth.

Then the restore runs, and this is the part worth knowing:

:::note[A restore never deletes]
Your current data directory is **moved** to `<dataDir>/pre-restore-<timestamp>/`,
not removed. If the restore turns out to be the wrong archive, the previous state
is still sitting there. Nothing cleans that folder up but you.
:::

The app relaunches against the restored data.

## Also available, but not a substitute

The server's own [`export-zip` and `import-zip`](/self-hosting/export-zip/)
commands work on a desktop install too, against the same data directory.

They are not a second backup, though, and it is worth being blunt about that
because the file extension invites the assumption: an export bundle carries
configuration — connections, pages, roles, views, overrides — and **none of your
rows**, no audit log, and no job or session history. The zip on this page
carries all of it. Reach for `export-zip` to move an instance or put its
configuration in source control; reach for **File → Back up now…** to be able to
get this install back.

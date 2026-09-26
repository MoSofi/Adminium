---
title: Installing apps
description: Hosted apps install from your build, from a file you upload, or from the online app catalogue — an opt-in of its own, served by the same two hosts as add-ons.
sidebar:
  order: 11
---

An **app** is a whole product Adminium hosts for you — an appointment desk, a client portal, a
box office — served at `/apps/<key>/<side>/` and backed by tables in *your* database. Apps are
installed and managed from **Studio → Hosted apps**.

Whatever an app's source, the way in is the same: its sha512 hash is verified against a pinned
value, the archive is unpacked under hardened limits, its manifest is validated, and **every table
it needs is checked and shown to you before a single one is created**. Nothing is served until you
press **Install**.

This page covers where app packages come from and what each source sends over the network, then
installing, updating and uninstalling. Running an installed app — its switches, addresses, sample
data, roles and public access — is covered under [An app's settings page](/guides/apps/settings/).
Add-ons, which extend a deployment rather than being one, have
[their own page](/self-hosting/installing-add-ons/) and their own switch.

Installing, updating and uninstalling an app all need the **Install and manage apps and add-ons**
permission.

## Three sources, one pipeline

| Source | Network | Where it comes from |
|---|---|---|
| **Bundled** | none | Tarballs in the folder [`ADMINIUM_BUNDLED_APPS`](#adminium_bundled_apps) names, seeded into the app store at boot. |
| **Uploaded** | none | A `.tgz` you upload yourself, with the fingerprint you paste. |
| **The online app catalogue** | opt-in | Released apps listed by adminium.dev, downloaded from `downloads.adminium.dev`. |

No build Adminium publishes carries a bundled app set — not the Docker image, not the desktop app,
not a source checkout — so the shelf is empty until you upload an app or switch browsing online on.
That is expected, not a misconfiguration. An image you build yourself can carry one.

## Browsing online: an explicit opt-in of its own

The shelf can also list apps from the **online app catalogue**: released apps that are not in your
build. It is a toggle in the shelf's header, it is **off by default**, and it is **separate from the
add-on catalogue's toggle** — a deployment may want one and not the other, and one switch could not
say that.

Browsing is a disk read. With the toggle on, the shelf shows what the last refresh cached; **Check
for newer** is the separate, explicit action that goes and fetches the list. Turning the toggle off
again stops the cached list being offered at all, even though the file stays on disk.

Two things veto the toggle outright, so it stays off even when switched on:

- `ADMINIUM_NETWORK_FEATURES=off` — the air-gap policy answer, which covers this exactly as it
  covers webhooks, OAuth and provider-API AI.
- The desktop app's air-gap mode.

With the toggle on, exactly **two hosts** are ever contacted, both pinned in code — the same two
that serve add-ons:

| Host | What it serves |
|---|---|
| `adminium.dev` | The app feed — a static JSON file listing each released app's newest version, the sha512 its release recorded, its name and one-line description in eight languages, and the minimum Adminium it needs. |
| `downloads.adminium.dev` | The app files themselves, one `.tgz` per released version, under `/apps/`. |

There is no third host, no redirect following, and no `latest` resolution. The server builds each
download address itself from the app's key and exact version —
`https://downloads.adminium.dev/apps/<key>/<key>-<version>.tgz` — and the downloaded bytes must
match the sha512 the feed carries before anything is unpacked. That value comes from the release
ledger, never from the download host, so the folder that serves the file is never the one vouching
for it.

:::caution[What an online install discloses]
Both are ordinary HTTPS requests. Refreshing the list tells `adminium.dev` your deployment's **IP
address** and **Adminium version**; downloading tells **Cloudflare**, which serves
`downloads.adminium.dev`, the same two things plus the **exact app and version** you pulled, at that
moment. That is the entire reason the catalogue is opt-in rather than on.
:::

## An app that needs a newer Adminium

Every released app declares the oldest Adminium it can run on. A release that needs a newer one than
you are running is **listed, with the version it needs, and cannot be installed** — the card says so
and the button does not offer to try. It is listed rather than hidden so that an app you have read
about does not simply go missing; upgrade Adminium and it becomes installable.

## Installing an app

Choose an app on the shelf, or **Install an app** to upload one. The wizard has four steps:
**Bundle**, **Database**, **Schema plan** and **Done**.

1. **Bundle.** For an upload, the `.tgz` and, optionally, its `sha512-` fingerprint. For an app
   from the shelf, the app you picked.
2. **Database.** The connection the app's tables go into, and the one it reads afterwards. Only a
   writable connection can be chosen.
3. **Schema plan.** The table check, the app's public access and the sample data box, described
   below. Nothing has been written yet.
4. **Done.** Which tables were created, which were used as they were, and which pages were made.

### Check the tables

The **Check the tables** screen lists every table the app needs, under its real name in that
database, with one badge each:

| Badge | What it means | What happens |
|---|---|---|
| **New** | No table has that name | It is created. **Create preview** shows the statement |
| **Yours from an earlier install** | Adminium recorded it for this app before, for example before an uninstall that kept the tables | It is used as it is, with its rows |
| **Shared with** *another app* | Another installed app uses a table of the same declared shape | Both apps read and write the same rows |
| **Name taken** | A table with that name exists and no app recorded it | You choose what to do with it, below |

When the app uses an existing table, the check also lists the changes it needs before the app can
write to it. Only changes that lose nothing are offered: adding a missing column, making a column
wider (a longer text column, text instead of a short one, a bigger integer), letting the key number
new rows by itself, and adding allowed values. **No column is removed and no data is lost.** Any
other difference is refused, with the table and column named.

### A table whose name is taken

Adminium never takes over a table it did not make without asking. **Install** waits until each
taken table has an answer:

- **Use it and keep its data.** The app reads and writes the rows already there. This is offered
  only when it is safe. A table with a required column the app never fills is refused, because the
  database would reject every row the app saves; the screen names those columns and says so.
- **Rename the existing table out of the way.** Your table gets a new name (by default the old one
  plus `_old`), and a fresh table is created for the app. Adminium updates its own pages, grants,
  column rules and public endpoints that pointed at the old name, as a
  [schema rename](/guides/schema/editing-your-schema/#what-follows-a-change-and-what-does-not)
  does. Not offered when another app records that table.
- **Use a different prefix for this app.** Every table of the app gets the prefix you type, lower
  case and ending in `_`, and the whole check runs again. **Use the usual prefix** goes back.

Picking an answer checks the tables again at once. After typing a new name or a prefix, press
**Check again**; **Install** waits until the check on screen matches your answers.

### Apps whose tables are prefixed

Most apps name their tables with a prefix made from the app's key: an app with the key `pos` makes
`pos_menu_items`, not `menu_items`, so its tables cannot collide with yours or with another app's.
The app reads its tables under whatever real names the install gave them. An app whose tables are
not prefixed uses the names it declares.

A name longer than the database allows (63 bytes on PostgreSQL and SQLite, 64 on MySQL) is refused
at the check, and a shorter prefix fixes it.

### Public access and sample data

Two boxes can sit under the table check:

- **Public access**, when the app has customer screens. It lists what they will be able to do
  through the public API, and **Allow this public access** is ticked. See
  [An app's public access](/guides/apps/public-access/).
- **Sample data**, when the app ships some. **Add sample data** is **not** ticked. When ticked,
  the records are added after the install finishes, and a failure there does not undo the install.
  See [Sample data](/guides/apps/sample-data/).

### If the database changed in the meantime

**Install** sends the check you looked at. If a table was created, dropped or changed after the
check was made, the install is refused with `SCHEMA_DRIFT`: "The database changed since this
install was checked." The wizard runs the check again and shows the new one. Nothing was written.

### An install that stops part way

MySQL cannot undo a table it has created, so no engine rolls an app install back. Adminium records
each step instead. If one fails, the install answers `409` with the code `APP_INSTALL_INCOMPLETE`
and names the step it stopped at: the tables, reading them back, the pages, or finishing. The
screen shows **The install stopped part way**, what was already made, and what the database said.

**Nothing is removed.** **Try again** runs the same install again and finishes from where it
stopped: tables that were made are recognised as this install's own, and nothing is created twice.
**Back to Schema plan** checks the tables again first. An install that stopped part way is not
served until it finishes.

### An app already installed on another connection

An app runs on one connection. Once it is installed (or stopped part way) on one, the plan for any
other connection says it cannot be installed there and names the connection it is on, and an
install sent anyway answers `409` with the code `APP_INSTALLED_ELSEWHERE`. Nothing is written.
Update it where it is, or uninstall it there first and then install it on the other connection.

## Updating

When a newer version of an installed app is available — already on disk, or offered by the
catalogue — the installed row and the app's own page offer **Update**. It downloads the version
first if it has to, then checks the tables again:

- **The same check, for what is new.** When the new version needs a table the installed one did
  not have, needs a change to an existing table, or finds a name taken, **Update** opens the table
  check before anything runs. A version that needs nothing new applies straight away.
- **Unique rules as a fresh install has them.** A column the app keeps unique that the table lets
  repeat is given its rule by the update. If rows already repeat a value there, the check names
  the column and nothing runs until they differ.
- **The table names stay.** An update uses the database and the table names the install already
  has. It never offers a different prefix; moving an app to other names is an uninstall and an
  install.
- **A refused update says why.** When the new version cannot be applied to this database, the
  message lists each reason, and the installed version keeps running untouched.
- **Pages follow the version, except yours.** New pages are added and untouched ones rebuilt. A
  page someone edited is left exactly as it is.
- **Public access follows the version, with your say.** When the new version adds to what the
  app's customers can do, or turns a staff screen's key into one a shared link opens, the check
  shows it on the **Allow this public access** card, and it is given only if you tick it. Through
  the API, send `"publicAccess": true` with the update; without it nothing new is given. What the
  version no longer declares is taken back from the app's keys on every update, and a key it no
  longer declares is revoked. An endpoint the new version would widen is left as it was.
- The app keeps its place: same row, same database connection, same mounts. Older versions of the
  package are removed from disk only after the update succeeds.

## Tables made before prefixes

An app that started prefixing its tables in a later version may still be installed under the old,
plain names. Its row on **Installed apps**, and the **Data** card on its settings page, then say
**This install uses the old table names.** and offer **Rename to** *prefix*….

The dialog lists every table with its new name before anything runs. **Rename tables** renames
them all in one schema change, and Adminium updates its own pages, grants, column rules, public
endpoints and table records to the new names. Open dashboards and the app's screens read the new
names without a restart.

## Sideloading: air-gapped installs

An install with no outbound network can still add an app. On any connected machine, download the
file from the app's page on [adminium.dev/marketplace](https://adminium.dev/marketplace), or
straight from its address:

```bash
curl -fO https://downloads.adminium.dev/apps/<key>/<key>-<version>.tgz
```

Note the sha512 fingerprint shown beside the Download link — the same value the app's own
`RELEASES.json` records, written there only after the release pipeline read the file back from
`downloads.adminium.dev`. Move the file to the air-gapped machine, choose **Install an app** on the
Hosted apps page, upload it, and paste the fingerprint. The key and version are read from the
manifest inside the bundle; you never type them.

Sideloading is a first-class source, not an escape hatch: the uploaded bytes go through the same
hash verification, hardened unpack and schema plan as a bundled or downloaded one. A tarball that
does not match the fingerprint you pasted is refused, and nothing is staged.

## On a host with no persistent disk

An installed app's files are kept in `ADMINIUM_DATA_DIR/apps`. The meta store only records that the
app is installed, and a [storage destination](/self-hosting/env-vars/#adminium_storage_url) does not
hold it. So on a host that empties the data directory on every deploy — DigitalOcean App Platform,
or a container with no volume — **every installed app is lost at the next deploy**:

- Studio lists it under **Installed apps** marked **Missing**, with a line saying its files are not
  on this server. The shelf shows the same badge in place of the green "Installed".
- Its `/apps/…` addresses answer `503` with the code `APP_FILES_MISSING`. Before 0.3.0 they
  answered the dashboard's "page not found" page with **HTTP 200**, so an uptime check that read
  only the status code stayed green; a check on `/apps/<key>/<side>/` now goes red, which is what
  you want it to do.
- The tables it created in your database are kept, with their rows.
- The boot log names it: `installed app is not on this server …`, with its key and version.
- The cached catalogue is gone too, so the shelf is empty until **Check for newer** runs again.
  A lost app you uploaded yourself is never in that feed, so before 0.3.0 it appeared in no list
  at all while the install record still said it was there; it is now listed as Missing regardless.

To bring an app back, choose **Install an app**, upload the same version's file with its
fingerprint, and confirm. The plan reuses the tables the app already has: nothing is created twice
and nothing is dropped. The shelf cannot do this for you: it shows the app as missing and offers
no download.

To keep apps across deploys, run Adminium where the data directory is on a persistent disk, or build
your own image that carries the app files in `/app/apps-bundle` — see
[`ADMINIUM_BUNDLED_APPS`](#adminium_bundled_apps). Each boot then copies them back.

## Uninstalling

**Uninstall**, on the installed row or in the **Danger zone** of the app's page, opens a dialog
that lists what goes and what stays, read from the server before anything happens.

| Removed | Kept |
|---|---|
| The app's files | Its tables, and every record in them |
| The pages it made that nobody edited, with their grants | Pages you edited, as ordinary pages |
| Its browser key, revoked, and the public endpoints it made | Its entries in the audit log |
| Its roles | |
| Its settings, placement, name and extra instances | |
| The column rules it wrote, unless someone changed them | |
| Its domains | |

Removing an app's role takes it from everyone who holds it, and **deletes** the API keys bound to
it. When a role has members or keys, the dialog says how many before you confirm.

### Deleting its tables too

Tables and data are kept unless you tick **Also delete its tables and data** and type the app's key
to confirm; the button then reads **Uninstall and delete data**. Only the tables this app created
and no other app uses are dropped, and the dialog lists them. A table the app found and used, or
shares with another app, is always kept. This cannot be undone, and it needs Super Admin: the
option is not shown to anyone else.

### After an uninstall

- **A reinstall recognises the kept tables.** Installing the same app into the same database
  again shows them as **Yours from an earlier install** and uses them, with their rows.
- **A domain mapped to the app stops serving.** Its DNS still points here, so every request to
  it answers `503` with the code `SURFACE_UNAVAILABLE` until you attach the host to an app again.
  It never falls back to the dashboard.

## `ADMINIUM_BUNDLED_APPS`

Where the boot seed looks for the bundled set. Default: `./apps-bundle`, relative to the server's
working directory. The published Docker image has no such folder. Its working directory is `/app`,
so an image you build from it can add `/app/apps-bundle` and needs nothing set:

```dockerfile
FROM ghcr.io/mosofi/adminium:<version>
COPY apps-bundle/ /app/apps-bundle/
```

Each app is a `<key>-<version>.tgz` next to a `<key>-<version>.tgz.integrity` file holding its
`sha512-…` fingerprint, the one shown beside its Download link. Every file is checked against its
fingerprint at boot, and a version already in the store is skipped. Put in the exact version you
install: a version the image does not carry is lost again at the next deploy on a host with no
persistent disk. See [Environment variables](/self-hosting/env-vars/#adminium_bundled_apps).

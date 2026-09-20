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
value, the archive is unpacked under hardened limits, its manifest is validated, and **the schema
plan is shown to you before a single table is created**. Nothing is served until you confirm it.

This page is about where app packages come from, and what each source does — and does not — send
over the network. Add-ons, which extend a deployment rather than being one, have
[their own page](/self-hosting/installing-add-ons/) and their own switch.

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

## Updating

When a newer version of an installed app is available — already on disk, or offered by the
catalogue — the installed row offers **Update**. It downloads the version first if it has to, then:

- **New tables are created, and you see them first.** If the new version needs tables the installed
  one did not, they are shown as DDL before anything is created, in the database the app already
  uses. A version that needs nothing new applies straight away.
- **Nothing is altered or dropped.** A table that exists but is missing columns the new version
  needs **refuses the update** and names them; Adminium does not alter tables it did not create in
  this operation, and never drops data.
- The app keeps its place: same row, same database connection, same mounts. Older versions of the
  package are removed from disk only after the update succeeds.

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

Uninstalling an app removes its **package files**, its surfaces and Adminium's own records of it. It
**never touches the tables it created in your database** — those stay, with their rows. Data
outlives the code that produced it; drop the tables yourself if you truly want them gone.

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

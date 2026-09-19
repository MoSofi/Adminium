---
title: Installing add-ons
description: The bundled add-on set works with zero network; browsing online is an explicit opt-in, and sideloading covers air-gapped installs.
sidebar:
  order: 10
---

Add-ons are packages that extend a deployment — extra blocks, data packs,
integrations — installed and managed from **Workspace settings → Add-ons**. Every package,
whatever its source, goes through the same pipeline on the way in: its sha512
hash is verified against a pinned value, the archive is unpacked under hardened
limits, and its manifest is validated before anything is registered.

This page is about where packages come from, and what each source does — and
does not — send over the network.

## What the page shows

Each add-on is a card: its name and one line about what it does, both in your
own language where the catalog carries a translation; the categories it belongs
to; and whether installing will ask you for a credential — an API key or an
OAuth connection — before you download anything. A category rail on the left
filters the grid and shows how many add-ons sit in each one, and the search box
matches names and descriptions.

The card tells you what an add-on *is*. It deliberately does not list what the
add-on may reach: that belongs to the install plan, which appears when you press
Install and names every table and every host before anything is registered.

:::note
A checkout running from source (`pnpm dev`) ships **no bundled set** — those are
baked into the Docker image and the desktop app at build time. So a source run
shows an empty catalog until you switch browsing online on, or upload a package
yourself. That is expected, not a misconfiguration.
:::

## The bundled set: zero network

The Docker image and the desktop app ship with a **bundled set** of first-party
add-ons: the tarballs and their integrity pins are baked in at build time,
already verified against the release ledger. At boot the server seeds them into
its add-on store — copy-if-absent, with every hash re-verified on the way in —
so the Add-ons page has something real to browse **without a single outbound
request**.

That is the default experience. An air-gapped install browses the bundled set,
installs from it, enables, disables, and uninstalls — all of it local file I/O.

Seeding is per-package and best-effort: one unreadable bundle entry is reported
in the boot log and skipped, and the rest still arrive. A bundled package whose
bytes no longer match its integrity sidecar is a corrupt image and is refused
rather than installed.

## Browsing online: an explicit opt-in

The Add-ons page can also browse the **online catalog** — newer versions and
packages that are not in your build. That is a toggle, it is **off by
default**, and nothing contacts the network until you turn it on.

The catalog is a static file published with adminium.dev, so it lists what was
released as of that site build. Browsing reads only what is already on disk —
the bundled set plus whatever the last refresh cached — and **Check for newer**
is the separate, explicit action that goes and fetches it.

Two things veto the toggle outright, so it stays off even if switched on:

- `ADMINIUM_NETWORK_FEATURES=off` — the air-gap policy answer covers the
  catalog exactly as it covers webhooks, OAuth, and provider-API AI.
- The desktop app's air-gap mode.

With the toggle on, exactly **two hosts** are ever contacted, both pinned in
code:

| Host | What it serves |
|---|---|
| `adminium.dev` | The catalog index — a static JSON file of a few KB, listing each add-on's exact version and the sha512 its release recorded. |
| `downloads.adminium.dev` | The add-on files themselves, one `.tgz` per released version, under `/add-ons/`. |

The same two hosts serve **apps**, under their own feed and their own `/apps/` folder, behind a
switch of their own — see [Installing apps](/self-hosting/installing-apps/). Turning this one on
says nothing about that one.

There is no third host, no redirect following, and no `latest` resolution. The
server builds each download address itself, from the add-on's key and exact
version — `https://downloads.adminium.dev/add-ons/<key>/<key>-<version>.tgz` —
and the downloaded bytes must match the sha512 the catalog carries before
anything is unpacked. The catalog takes that value from the release ledger, never
from the download host, so the folder that serves the file is never the one
vouching for it.

:::caution[What an online install discloses]
Both are ordinary HTTPS requests. Refreshing the catalog tells `adminium.dev`
your deployment's **IP address** and **Adminium version**; downloading tells
**Cloudflare**, which serves `downloads.adminium.dev`, the same two things plus
the **exact add-on and version** you pulled, at that moment. That is the entire
reason the catalog is opt-in rather than on: the bundled set exists so that
nobody has to accept even that disclosure just to use add-ons.
:::

## Sideloading: air-gapped installs

An install with no outbound network can still add packages the bundle does not
carry. On any connected machine, download the file from the add-on's page on
[adminium.dev/marketplace](https://adminium.dev/marketplace), or straight from
its address:

```bash
curl -fO https://downloads.adminium.dev/add-ons/<key>/<key>-<version>.tgz
```

Note the sha512 fingerprint shown beside the Download link. The same value is
recorded in `RELEASES.json` in the
[`Adminiumjs/add-ons`](https://github.com/Adminiumjs/add-ons) repository, where
the release pipeline writes it only after reading the file back from
`downloads.adminium.dev`. Then move the file to the air-gapped machine, upload it
through the **sideload card** on the Add-ons page, and paste the fingerprint.

Sideloading is a first-class source, not an escape hatch: the uploaded bytes go
through the same hash verification and hardened unpack as a bundled or
catalog-fetched package. A tarball that does not match the hash you pasted is
refused.

## On a host with no persistent disk

An installed add-on's files are kept in `ADMINIUM_DATA_DIR/add-ons`. The meta store only records
that it is installed, with its settings and credentials. On a host that empties the data directory
on every deploy — DigitalOcean App Platform, or a container with no volume — the boot copies back
only what the image bundles, at the bundled version:

- **A bundled add-on, installed at the bundled version, comes back by itself.**
- **Any other add-on is lost at the next deploy**: one you uploaded, or one you updated past the
  image's copy. The Add-ons page lists it under **Installed** marked **Missing**, with a line
  saying its files are not on this server. The boot log names it too: `installed add-on is not on
  this server …`, with its key and version.

  Before 0.2.11 that row read as a healthy install — including its green **Connected** badge, since
  the stored credential outlives the volume while the files do not — and an add-on the cached
  catalog feed did not carry, which is every one you uploaded yourself, was left out of the browse
  list entirely. The log was the only place the loss was stated.
- **A newer Adminium image can bundle a newer version.** Then the version you installed from the
  old image is lost the same way. The Add-ons page offers **Upgrade** to the version the new image
  carries, and upgrading brings the add-on back.
- The cached online catalog is gone too, until **Check for newer** runs again.

To bring a lost add-on back, upload the same package again through the sideload card, with its
fingerprint. It is back at once, server code included, with its settings and connection as they
were.

To keep add-ons across deploys, run Adminium where the data directory is on a persistent disk, or
build your own image that carries them — see [`ADMINIUM_BUNDLED_ADD_ONS`](#adminium_bundled_add_ons).

:::caution[0.2.9 and earlier]
These releases load add-on server code before the boot has copied the bundled add-ons back. After a
deploy onto an empty data directory, a bundled add-on with server code — Invoices & Receipts, for
one — is listed as on but does nothing until the add-ons are reloaded. Switch any one installed
add-on off and on again; that reloads all of them. The same step is needed after re-uploading a
lost package.
:::

## Uninstalling

Uninstalling an add-on removes its **package files** and Adminium's own records
of it (including any stored credentials). It **never touches tables the add-on
created in your database** — those stay, with their rows. Data outlives the
code that produced it; drop the tables yourself if you truly want them gone.

## `ADMINIUM_BUNDLED_ADD_ONS`

Where the boot seed looks for the bundled set. Default: `./add-ons-bundle`,
relative to the server's working directory — which is where the Docker image
parks it, so a container needs nothing set. The desktop app sets the variable
itself, pointing at the copy inside its own resources.

Override it to seed from your own directory of pre-verified packages:

```bash
ADMINIUM_BUNDLED_ADD_ONS=/srv/adminium/add-ons-bundle adminium start
```

The layout is flat: `<key>-<version>.tgz` next to a `<key>-<version>.tgz.integrity`
sidecar holding the `sha512-…` string. A directory that does not exist is a
no-op, not an error. Every tarball is verified against its sidecar on the way
into the store — the variable chooses where the seed reads from, never whether
verification happens.

On a host with no persistent disk, this folder is the only place an add-on
outside the bundled set survives a deploy. The image's working directory is
`/app`, so an image you build from the published one can add files to the
folder it already has, with nothing to set:

```dockerfile
FROM ghcr.io/mosofi/adminium:<version>
COPY add-ons-bundle/ /app/add-ons-bundle/
```

Put in the exact version you install. A version the image does not carry is
lost again at the next deploy.

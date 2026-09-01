---
title: Installing add-ons
description: The bundled add-on set works with zero network; browsing online is an explicit opt-in, and sideloading covers air-gapped installs.
sidebar:
  order: 10
---

Add-ons are npm packages that extend a deployment — extra blocks, data packs,
integrations — installed and managed from **Studio → Add-ons**. Every package,
whatever its source, goes through the same pipeline on the way in: its sha512
hash is verified against a pinned value, the archive is unpacked under hardened
limits, and its manifest is validated before anything is registered.

This page is about where packages come from, and what each source does — and
does not — send over the network.

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

Two things veto the toggle outright, so it stays off even if switched on:

- `ADMINIUM_NETWORK_FEATURES=off` — the air-gap policy answer covers the
  catalog exactly as it covers webhooks, OAuth, and provider-API AI.
- The desktop app's air-gap mode.

With the toggle on, exactly **two hosts** are ever contacted, both pinned in
code:

| Host | What it serves |
|---|---|
| `adminium.dev` | The catalog index — a static JSON file of a few KB. |
| `registry.npmjs.org` | The package metadata (to pin the exact version and hash) and the tarball itself. |

There is no third host, no redirect following, and no `latest` resolution — an
install pins an exact `package@version` whose integrity must agree with the
release ledger before the download is accepted.

:::caution[What an online install discloses]
Downloading from the npm registry is an ordinary HTTPS request, which means npm
learns your deployment's **IP address** and the **exact package and version**
you pulled, at that moment. That is the entire reason the catalog is opt-in
rather than on: the bundled set exists so that nobody has to accept even that
disclosure just to use add-ons.
:::

## Sideloading: air-gapped installs

An install with no outbound network can still add packages the bundle does not
carry. On any connected machine:

```bash
npm pack @adminiumjs/add-on-<key>
```

That writes `adminiumjs-add-on-<key>-<version>.tgz` in the current directory.
Look up the expected sha512 for that key and version in `RELEASES.json` in the
[`Adminiumjs/add-ons`](https://github.com/Adminiumjs/add-ons) repository — the
publish pipeline records every released tarball's integrity there — then move
the tarball to the air-gapped machine and upload it through the **sideload
card** on the Add-ons page, pasting the expected hash.

Sideloading is a first-class source, not an escape hatch: the uploaded bytes go
through the same hash verification and hardened unpack as a bundled or
catalog-fetched package. A tarball that does not match the hash you pasted is
refused.

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

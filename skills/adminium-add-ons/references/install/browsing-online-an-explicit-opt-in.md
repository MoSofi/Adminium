<!-- produced from apps/docs/src/content/docs/self-hosting/installing-add-ons.md § Browsing online: an explicit opt-in; do not edit -->

# Installing add-ons: Browsing online: an explicit opt-in

The Add-ons page can also browse the **online catalog** — newer versions and
packages that are not in your build. That is a toggle, it is **off by
default**, and nothing contacts the network until you turn it on.

The catalog is adminium.dev's marketplace API, so a refresh sees a release as
soon as the site has checked it — no site build in between. Browsing reads only
what is already on disk — the bundled set plus whatever the last refresh cached
— and **Check for newer** is the separate, explicit action that goes and
fetches it.

The request names your Adminium version, and the catalog answers with the
newest release of each add-on that version can install. An add-on whose every
release needs a newer Adminium is listed with the version it needs, and cannot
be installed. An add-on the site lists as **coming soon** is shown with that
badge and has nothing to download yet.

Two things veto the toggle outright, so it stays off even if switched on:

- `ADMINIUM_NETWORK_FEATURES=off` — the air-gap policy answer covers the
  catalog exactly as it covers webhooks, OAuth, and provider-API AI.
- The desktop app's air-gap mode.

With the toggle on, exactly **two hosts** are ever contacted, both pinned in
code:

| Host | What it serves |
|---|---|
| `adminium.dev` | The catalog — `GET /api/v1/marketplace/add-ons`, a JSON document listing each add-on's exact version and the sha512 its release recorded, with its name, one-line description and publisher. |
| `downloads.adminium.dev` | The add-on files themselves, one `.tgz` per released version, under `/add-ons/`. |

The same two hosts serve **apps**, under their own feed and their own `/apps/` folder, behind a
switch of their own — see [Installing apps](https://docs.adminium.dev/self-hosting/installing-apps/). Turning this one on
says nothing about that one.

There is no third host, no redirect following, and no `latest` resolution. The
server builds each download address itself, from the add-on's key and exact
version — `https://downloads.adminium.dev/add-ons/<key>/<key>-<version>.tgz` —
and the downloaded bytes must match the sha512 the catalog carries before
anything is unpacked. The catalog takes that value from the release ledger, never
from the download host, so the folder that serves the file is never the one
vouching for it.

> **Caution: What an online install discloses**
> Both are ordinary HTTPS requests. Refreshing the catalog tells `adminium.dev`
> your deployment's **IP address** and **Adminium version**; downloading tells
> **Cloudflare**, which serves `downloads.adminium.dev`, the same two things plus
> the **exact add-on and version** you pulled, at that moment. That is the entire
> reason the catalog is opt-in rather than on: the bundled set exists so that
> nobody has to accept even that disclosure just to use add-ons.

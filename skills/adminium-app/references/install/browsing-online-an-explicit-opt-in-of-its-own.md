<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Browsing online: an explicit opt-in of its own; do not edit -->

# Installing apps: Browsing online: an explicit opt-in of its own

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
| `adminium.dev` | The app catalogue — `GET /api/v1/marketplace/apps`, a JSON document listing each released app's newest version your Adminium can install, the sha512 its release recorded, its name and one-line description in eight languages, the minimum Adminium it needs, and the add-ons it requires. Apps the site lists as **coming soon** appear with that badge and nothing to download. |
| `downloads.adminium.dev` | The app files themselves, one `.tgz` per released version, under `/apps/`. |

There is no third host, no redirect following, and no `latest` resolution. The server builds each
download address itself from the app's key and exact version —
`https://downloads.adminium.dev/apps/<key>/<key>-<version>.tgz` — and the downloaded bytes must
match the sha512 the feed carries before anything is unpacked. That value comes from the release
ledger, never from the download host, so the folder that serves the file is never the one vouching
for it.

> **Caution: What an online install discloses**
> Both are ordinary HTTPS requests. Refreshing the list tells `adminium.dev` your deployment's **IP
> address** and **Adminium version**; downloading tells **Cloudflare**, which serves
> `downloads.adminium.dev`, the same two things plus the **exact app and version** you pulled, at that
> moment. That is the entire reason the catalogue is opt-in rather than on.

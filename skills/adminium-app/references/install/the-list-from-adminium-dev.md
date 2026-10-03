<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § The list from adminium.dev; do not edit -->

# Installing apps: The list from adminium.dev

The shelf lists the apps adminium.dev offers beside what is on the server. Each has one button,
**Install**. It downloads the app and opens **one dialog**: the database it goes into, what it
adds there, and the add-ons it brings, with **Cancel**, **Install** and **More choices**.

- With one database connected, the dialog takes it and reads the app's plan against it at once.
  Nothing is added until you press Install.
- **More choices** opens the full wizard on the same downloaded app: another database, a table
  prefix, sharing tables with an app you already have, sample data. Where the dialog cannot decide
  for you (more than one database, or none yet), More choices is its main button and it says why.
- Cancel leaves the downloaded file on the server; the next Install opens the dialog at once.

**On a new install the list is on.** The server asks adminium.dev for it once when it starts (when
it holds no list, or one older than a day), once a day after that, and when the page opens on a
list older than a day. **Check for newer** asks at once. Browsing itself is a disk read.

**A server installed before 0.3.16 keeps what it had.** If its list was off it is still off after
the upgrade and asks adminium.dev for nothing; the shelf shows one button, **Show what is
available**, with a line on what showing it sends.

The switch is in the shelf's header and is **separate from the add-on list's switch**: a deployment
may want one and not the other. Switching it off stops the cached list being offered at all, even
though the file stays on disk. Two things outrank the switch, so the list stays off even when it
is switched on:

- `ADMINIUM_NETWORK_FEATURES=off` — the air-gap answer, which covers this exactly as it covers
  webhooks, OAuth and provider-API AI. Set before the first start, a new install never asks.
- The desktop app's air-gap mode.

### What is sent, and to whom

| When | To | What it learns |
|---|---|---|
| The list is read (at start, daily, **Check for newer**) | `adminium.dev` | Your server's **IP address**, the **time**, and its **Adminium version**. |
| You press Install on an app | **Cloudflare**, which serves `downloads.adminium.dev` | The same, plus the **app and version** you pulled. |

Where the add-on list is on as well, the start-up and daily refresh ask for both lists in one
request (`GET /api/v1/marketplace`); a list that is off is never asked for.

With the list on, exactly **two hosts** are ever contacted, both pinned in code — the same two
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

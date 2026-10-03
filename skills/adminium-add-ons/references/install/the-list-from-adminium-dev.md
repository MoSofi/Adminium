<!-- produced from apps/docs/src/content/docs/self-hosting/installing-add-ons.md § The list from adminium.dev; do not edit -->

# Installing add-ons: The list from adminium.dev

The Add-ons page lists what adminium.dev offers beside what is already on the server: newer
versions, and add-ons that are not in your build. Each has one button, **Install**. It downloads
the add-on, then shows what it adds, what it reaches and what it attaches to, with **Cancel** and
**Install**. Nothing is installed before that second Install; Cancel leaves the downloaded file on
the server, and the next click opens the dialog at once.

**On a new install the list is on.** The server asks adminium.dev for it once when it starts (when
it holds no list, or one older than a day), once a day after that, and when the page opens on a
list older than a day. **Check for newer** asks at once. Browsing itself reads only what is on disk.

**A server that was installed before 0.3.16 keeps what it had.** If its list was off, it is still
off after the upgrade and asks adminium.dev for nothing: the page shows one button, **Show what is
available**, with a line on what showing it sends. A choice you made, on or off, is never changed
by an upgrade.

The request names your Adminium version, and the list answers with the newest release of each
add-on that version can install. An add-on whose every release needs a newer Adminium is listed
with the version it needs, and cannot be installed. An add-on the site lists as **coming soon** is
shown with that badge and has nothing to download yet.

### What is sent, and to whom

| When | To | What it learns |
|---|---|---|
| The list is read (at start, daily, **Check for newer**) | `adminium.dev` | Your server's **IP address**, the **time**, and its **Adminium version**. Nothing about your data, your users or what you have installed. |
| You confirm an install or an upgrade | **Cloudflare**, which serves `downloads.adminium.dev` | The same, plus the **add-on and version** you pulled. |

No add-on is named to anyone until a person presses Install.

### Switching it off

Two ways, and either is enough:

- **The switch on the Add-ons page** (it needs the permission to manage add-ons). Off, the page
  lists only what is on the server, and nothing is asked of adminium.dev.
- **`ADMINIUM_NETWORK_FEATURES=off`** in the environment, and the desktop app's air-gap mode. These
  outrank the switch: the list stays off even if someone turns the switch on, exactly as they
  cover webhooks, OAuth and provider-API AI. Set it before the first start and a new install never
  asks for the list at all.

Both are checked before any address is built. The update check (`updates.checkEnabled`) and
telemetry are separate, and both stay off until you turn them on.

> **Note: A host with no disk**
> On a host that keeps no files between deploys, the cached list is lost at each deploy, so each
> start asks for it again. That is one small request.

With the list on, exactly **two hosts** are ever contacted, both pinned in
code:

| Host | What it serves |
|---|---|
| `adminium.dev` | The catalog — `GET /api/v1/marketplace/add-ons`, a JSON document listing each add-on's exact version and the sha512 its release recorded, with its name, one-line description and publisher. |
| `downloads.adminium.dev` | The add-on files themselves, one `.tgz` per released version, under `/add-ons/`. |

The same two hosts serve **apps**, under their own feed and their own `/apps/` folder, behind a
switch of their own — see [Installing apps](https://docs.adminium.dev/self-hosting/installing-apps/). Switching one off says
nothing about the other. Where both lists are on, the start-up and daily refresh ask for both in
one request, `GET /api/v1/marketplace`; a list that is off is never asked for.

There is no third host, no redirect following, and no `latest` resolution. The
server builds each download address itself, from the add-on's key and exact
version — `https://downloads.adminium.dev/add-ons/<key>/<key>-<version>.tgz` —
and the downloaded bytes must match the sha512 the catalog carries before
anything is unpacked. The catalog takes that value from the release ledger, never
from the download host, so the folder that serves the file is never the one
vouching for it.

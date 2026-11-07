---
title: An app on several databases
description: Install the same app once on each database, so two businesses on one server each have their own copy. What each copy keeps to itself, its addresses, one version for every copy and Update every copy, and how API calls name a copy.
sidebar:
  order: 12
---

The same app or add-on can be installed **once per database**. Fernhill Coffee and Kiln Street
Pottery, on one server, each have their own Invoices & Receipts: their own business name, numbering,
settings, roles, templates and keys.

To add a copy, install the app again and pick another database: the **Database** step marks each
database that already has it ("Installed · 1.0.15"), and those cannot be picked. Uploading a file of
an app that is already installed offers **Install on another database**. See
[Installing apps](/self-hosting/installing-apps/).

## What each copy keeps to itself

Nothing crosses between copies. Each has:

- **its own row** on Hosted apps, named "on kiln", with its database's workspace chips;
- **its own page**, `/studio/apps/<key>~<slug>` for a later copy, with its own status, settings,
  After you install list, roles, Danger zone and domains;
- **its own settings** (the app's own, and an add-on's) and its own on/off switches for its screens;
- **its own roles**, labelled with the database ("Invoices clerk · kiln"), and its own grants;
- **its own email templates and outbox**: a later copy's templates are stored under their own keys,
  so editing Kiln's reminder never changes Fernhill's;
- **its own keys, public endpoints, document profiles and domains**;
- **its own tables**, in its own database.

Uninstalling, disabling, adding sample data or renaming acts on one copy: "Uninstall Invoices &
Receipts from kiln". The app's files leave the server only with its last copy.

A database that holds a copy cannot be deleted from Data connections until the app is uninstalled
from it (`CONNECTION_HAS_INSTALLS`).

### What stays once per server

- **Server-wide add-ons.** An add-on whose manifest says `addOn.scope: "server"` installs once, for
  the whole server. Payment providers do: two businesses on one server share one payment-provider
  account.
- **Apps from a project folder.** A folder holds one app, so a [project app](/projects/apps/) runs
  once per server.

## Addresses

The **first copy** of an app keeps the plain addresses: `/apps/<key>/<side>/`, `/a/<key>/`,
`/studio/apps/<key>` and the plain grants (`app:<key>:staff`).

A **later copy** gets a short name from its database, made once at install and never changed: the
database's name in lower case, accents dropped, `_` turned into `-`, at most 32 characters, with `-2`
added on a clash. Its addresses are `/apps/<key>/<slug>/<side>/`, `/a/<key>~<slug>/`,
`/studio/apps/<key>~<slug>` and `/add-ons/<key>~<slug>/…`, and its grants are
`app:<key>~<slug>:staff`. An app has at most 32 copies.

When the first copy is uninstalled, its plain addresses are not handed to another copy. They answer
`410`, code `APP_ADDRESS_RETIRED`, and none opens by itself. Someone signed in sees "Invoices &
Receipts is installed on kiln" with a link to each copy they can open. Someone signed out, or with no
copy they can open, is told only that the address moved, and no database is named. A later install
takes the freed address only when it asks for it.

### Screens of a later copy

An app's screens serve a later copy only when the app says they can (`frontends[].instances: true`
in its manifest). Without it, the later copy brings its pages, tables, roles and rules, and its row
says "This app's screens open for its first install only." Open the app on its first copy, or ask
its maker for a version whose screens declare it.

## One version for every copy

The server serves one set of files per app, so **every copy runs the same version**.

- **Update every copy.** Hosted apps has one Update per app, **Update every copy**. It updates the
  copies one at a time, in the databases' order, each through its own review. A cancelled review
  stops the rest; the button then reads **Update the rest**.
- **Each copy finishes on its own.** An update that stops on one copy is finished on that copy with
  **Finish the update**. The others are not held back.
- **Uploading a file of an installed app:**

| The file is | Offered |
|---|---|
| Newer than the copies | **Update every copy (fernhill, kiln)**, then optionally **Also install on another database** |
| The same version | **Install on another database** |
| Older | Refused, per database: "fernhill already has 1.1.0" |

A self-made app saved somewhere else under the same key is refused for the whole server, even though
copies are per database: "This server already has a different fernhill-ops, on fernhill. Save this
one with another key." The key names one app across the server.

## Naming a copy in an API call

Every route under `/api/v1/apps/<key>/…` and `/api/v1/add-ons/<key>/…` works on one copy. Name it
with one of:

- the `X-Adminium-Install: <install id>` header (the dashboard and the app's screens send it);
- `?connectionId=<connection id>`;
- the address form `<key>~<slug>` in the path.

With one copy, nothing needs naming. With several and none named, the answer is `409` with the code
`APP_INSTALL_AMBIGUOUS`, and `details.installs` lists each copy's database and slug. A route never
picks a copy for you. The public API (`/api/v1/public/*`) needs no naming: the key a page presents
belongs to one copy.

The copy is found first, then its rights are checked: a grant on Fernhill's copy does nothing on
Kiln's (`403`).

`GET /api/v1/apps` lists one row per copy, with `installId`, `slug`, `address` and the database's
name.

## Extra instances made before

An app's [extra instances](/guides/apps/settings/#extra-instances) made before copies existed keep
working as they did: they share the first copy's settings and roles. To make one a copy of its own,
`GET` then `POST /api/v1/apps/<key>/instances/<segment>/adopt`: the tables are used as they are,
the non-secret settings are copied (the reply names the secrets left behind), and the new copy's
staff grant is given to every role that held the first copy's.

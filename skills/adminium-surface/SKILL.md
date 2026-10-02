---
name: adminium-surface
description: Build the screens of an Adminium app — the staff side used by people signed in to Adminium, and the public customer side that uses the public API with a served browser key. Use when someone wants a custom front end, a staff screen, a booking, ordering or request form, a customer portal or any public page for an Adminium app. Open `adminium` and `adminium-app` first: the screens sit on the app's manifest.
license: AGPL-3.0-only
---

# Screens for an Adminium app

A side is a small React app in `apps/<key>/staff/` or `apps/<key>/customer/`, entered at
`src/main.tsx`. **build** bundles it; Adminium serves it at `/apps/<key>/<side>/`. Create the
folders with **new** `--staff` / `--customer` and change what it wrote. For an app that has no
side yet, add the folder, and add `{ "side": "<side>", "kind": "spa" }` to `frontends` in
`manifest/app.json` (replacing a `"kind": "none"` entry).

Read `references/guides/building-a-side--*.md` before writing a screen. The verbs are in
`commands.md`.

## The two sides are different programs

**Staff** runs inside Adminium as the signed-in person. No key. It reads and writes the app's
tables with that person's permissions:

```tsx
import { useStaff } from '@adminiumjs/adminium/side';
const loaded = useStaff();              // { state: 'loading' | 'error' | 'ready', value }
await loaded.value.list('jobs', { order: 'id.desc' });   // { rows, total }
await loaded.value.create('jobs', { title });             // also get, update, remove, can
```

Table names are the short ones: the `ref` of the part file. The person needs a role holding
`app:@:staff` and grants on the tables (`manifest/roles.json`).

**Customer** is public. Adminium serves it a browser key; with it the side reaches the public
API, and there **only what `manifest/access.json` grants**:

```tsx
import { createPublicClient } from '@adminiumjs/public-client';
import { useCustomer } from '@adminiumjs/adminium/side';
const loaded = useCustomer();
const client = createPublicClient(loaded.value);
const items = loaded.value.tables['items'] ?? 'items';   // the endpoint's name on this install
await client.list(items, { limit: 50 });                  // { data }, in key order
```

`createPublicClient` returns `null` when it has no address or key: check for it. The venue's
`timezone` and `currency` are in `await client.config()`, and the server's time in
`await client.now()`.

## The order of work for a customer screen

1. Decide what a stranger may read and what they may add. Write it in `manifest/access.json`.
2. **check**, and read the access lines. If the screen needs something not listed, it will be
   refused at run time: change `access.json`, not the screen.
3. Write the screen against exactly those tables and columns.
4. **try**. It asks the public API for what is granted and for what is not.

Rules of the public side:

- A table anyone may add to may not also be readable by anyone. Read from one table, add to
  another (the starter's `items` and `requests`).
- A public list comes in key order. `order`, `where` and `q` from the screen are refused
  (`PUBLIC_QUERY_REFUSED`): sort in the screen, and hide rows with `filters` in `access.json`.
- A create returns only the columns the entry's `select` lists. Do not expect the whole row.
- `PATCH` needs a guest who has signed in to reach their own row. Read
  `references/guides/identity-and-own-links--*.md` before building any "my booking" screen.
- No payments, no arbitrary queries, no code of yours on the server. A rule the public entry
  cannot hold a stranger to (a date not in the past) lives in the screen only. If the request
  needs more, say so.
- A create by a stranger should be limited: read
  `references/guides/public-access--limits-on-a-stranger-s-create.md` and
  `references/guides/public-access--the-human-check.md`.

## Things every screen must get right

- **The venue's clock, never the browser's.** Staff: the session's `timezone`; when its
  `timezoneIsFallback` is true, show a line saying times are in UTC. Customer: `client.config()`. Never call
  `Intl.DateTimeFormat().resolvedOptions().timeZone`. Format with `toTenantDay`,
  `toTenantMinutes` and `formatTenantMoney` from `@adminiumjs/public-client`.
- **Three states.** Every load has loading, error and ready. On a staff screen show the error's
  `message`: it is the server's own sentence. On a customer screen do not: a `PublicApiError`'s
  message is for developers, so say your own sentence for its `code`.
- **Only this origin.** A served screen may not load a script, stylesheet or font from another
  host, run an inline script, or call another host's API. Install the package and import it.
- **`can()` before a button.** Leave out a button whose write the person's role would refuse.
- **English, marked.** Wrap text people read in `en('…')` from `@adminiumjs/adminium/side`.
- **Paths are relative.** `nav.json` paths never start with `/`; use `mountBase()` for links.

## The sidebar

`staff/nav.json` lists the staff side's screens for the dashboard's sidebar:
`[{ "id": "jobs", "path": "", "label": "Jobs", "icon": "wrench" }]`. Icons are Lucide names.

## Before you say it works

**build**, then **try**. Try serves each side and every file it names, reads a table as staff, and
probes the public API (a read of each granted table, an empty create to each table that takes
one). It does not run the screens in a browser or type-check them (**build** bundles; it does not
check types): tell the person to open each screen once after installing, and that `?demo` on a
staff screen's address shows it on the sample rows without saving anything.

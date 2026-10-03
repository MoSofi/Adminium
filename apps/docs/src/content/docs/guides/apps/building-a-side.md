---
title: Building an app's screens
description: Write the staff and customer screens of an app in your project — the folder, what a side is given, reading and writing as staff, the public API as a customer, the venue's clock and money, and what a screen served by Adminium may not load.
---

An app can bring screens of its own beside its dashboard pages: a **staff side** for your team and
a **customer side** for the public. Each is a small React app in the app's folder, built by
[`adminium app build`](/reference/cli/#app-build) and served by Adminium at
`/apps/<key>/staff/` and `/apps/<key>/customer/`. This page is about writing them.
[An app in your project](/projects/apps/) covers the folder, the manifest and the commands.

## The folder

```
apps/repairs/
├── manifest/app.json           "frontends": [{ "side": "staff", "kind": "spa" }, …]
├── staff/
│   ├── src/main.tsx            where the side starts
│   ├── src/App.tsx             your screens
│   ├── src/theme.css           the look: colours, type, corners (imported from main.tsx)
│   ├── src/app.css             the parts a screen is made of, drawn from theme.css
│   ├── nav.json                its screens, for the dashboard's sidebar (optional)
│   └── public/                 files served as they are (optional)
└── customer/
    └── src/main.tsx
```

`main.tsx` mounts the app on the page's `root` element:

```tsx
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './theme.css';
import './app.css';

createRoot(document.getElementById('root')!).render(<App />);
```

Everything `main.tsx` imports is bundled: your components, CSS, and images and fonts imported by
address (`import logo from './logo.svg'`). The page itself is written by the build. There is no
`index.html` to edit.

## The look

The starter's screens come with a look, so a first build is something to show. It is two files on
each side:

- **`src/theme.css`** holds the look as values: the page and card colours, the text and muted
  text, one accent, the corner radius, the shadow, and the typefaces for text and for headings, in
  a light and a dark set. Change the look here, in one place.
- **`src/app.css`** holds the parts, drawn from those values. Use their class names instead of
  writing styles of your own for what a part already does:

| For | Classes |
|---|---|
| The page | `page` (`narrow` for one column), `site-header` with `brand` and `brand-mark`, `hero` with `eyebrow` and `lead`, `section` with `section-head`, `layout` (a wide column and an `aside` that stays in view), `site-footer` |
| What is on offer | a `grid` of `card`s, each with `card-media`, `card-title`, `card-row` and `price`; `stepper` for a quantity; `summary` with a `total` line |
| Forms | `form` of `field`s (a label, the input, an optional `hint`); `btn btn-primary` for the one main action, `btn` and `btn btn-quiet` for the rest; `btn-small`, `btn-block` |
| What the page says back | `notice ok`, `notice error`, `empty`, `badge` with `accent`, `good`, `warn` or `bad` |
| For staff | `toolbar`, a `list` of `list-row`s, a `board` of `column`s; `row`, `muted`, `small` |

A new side starts in the direction **clean**. There are four: `clean`, `warm`, `bold` and `calm`.
Adminium Designer asks which one when it first adds a side (unless the request already said how it
should look), keeps the answer in the app's `look.json`, and its **Change the look** writes
`theme.css` again in another direction. By hand, edit the values in `theme.css`.

Only the typefaces a device already has are used: a served screen may load no font from another
host (see [below](#what-a-served-screen-may-not-load)).

The header shows the app's name. `APP_NAME` from `@adminiumjs/adminium/side` is the name in the
app's manifest when the side was built, so renaming the app renames the header at the next build;
the config's `appName` is the operator's own name for the app, when they set one:

```tsx
import { APP_NAME } from '@adminiumjs/adminium/side';

const name = config.appName ?? APP_NAME;
```

## The two sides are not alike

| | Staff side | Customer side |
|---|---|---|
| Who uses it | Someone signed in to Adminium | Anyone |
| How it reaches data | The data API, with that person's own session | The [public API](/guides/public-api/endpoints-and-keys/), with a browser key Adminium serves |
| What it may reach | What the person's roles allow | Only what the manifest's `publicAccess` grants |
| Key in the code | None | None: it is served, never written into the bundle |

Both import their plumbing from `@adminiumjs/adminium/side`. The build supplies that module from
the Adminium doing the building.

## A staff side

```tsx
import { useEffect, useState } from 'react';
import { useStaff, type Row, type StaffSession } from '@adminiumjs/adminium/side';

export function App() {
  const loaded = useStaff();
  if (loaded.state === 'loading') return <p>Loading…</p>;
  if (loaded.state === 'error') return <p>{loaded.message}</p>;
  return <Jobs staff={loaded.value} />;
}

function Jobs({ staff }: { staff: StaffSession }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    void staff.list('jobs', { order: 'id.desc' }).then((listed) => setRows(listed.rows));
  }, [staff]);
  return <ul>{rows.map((row) => <li key={String(row.id)}>{String(row.title)}</li>)}</ul>;
}
```

The session `useStaff()` gives:

| | |
|---|---|
| `list(table, options?)` | Rows and the total. `options`: `limit` (at most 200, default 50), `offset`, `order` (`"created_at.desc"`), `q` (a search), `where` (a filter, as the data API takes it) |
| `get(table, id)` | One row |
| `create(table, values)` | Adds a row and returns it |
| `update(table, id, values)` | Changes a row and returns it |
| `remove(table, id)` | Deletes a row |
| `can(table, action)` | Whether the signed-in person may `read`, `create`, `update` or `delete` there. Use it to leave out a button whose write would be refused |
| `user` | `{ id, name, email }` of the person signed in |
| `settings` | The app's settings values |
| `timezone`, `timezoneIsFallback`, `currency` | The venue's, see below |
| `tables` | The real name of each table in the database |

`table` is the short name: the `ref` in `manifest/tables/<ref>.json`. Adminium names the real table
`<key>_<ref>` when the app is `prefixed`, and the session maps one to the other.

A refused write throws an error whose `message` is the server's own sentence and whose `code` is
its error code. On a staff screen, show the message: it names the column and says what is wrong.

A column that holds personal data (a name, a phone, an email) reads as empty to a person whose
role lacks `read_pii` on that table. A screen that shows customers' details needs a role that
grants it; see [Add a role](/guides/apps/manifest-by-task/#add-a-role).

`adminium app build` bundles the code and does not type-check it. To type-check a side, add
`typescript` to the project and a `tsconfig.json` that includes `apps/`.

The person must hold a role that may open the app's staff screens (`app:@:staff` in the app's
`roles.json`), and their grants on the app's tables decide what the reads and writes above may do.
See [App roles and staff access](/guides/apps/roles-and-staff-access/).

### Its place in the dashboard

`nav.json` lists the screens the staff side offers the dashboard's sidebar:

```json
[
  { "id": "jobs", "path": "", "label": "Jobs", "icon": "wrench" },
  { "id": "done", "path": "done", "label": "Done" }
]
```

`path` is added to wherever the side is opened, so it never starts with `/`. `icon` is a
[Lucide](https://lucide.dev) icon name. To find where the side is mounted — it differs between the
app's own address, a second instance, and a domain mapped to the app — call `mountBase()`.

## A customer side

A customer side reaches the public API, and there only what the app's `access.json` grants. Write
`access.json` first, run `adminium app check` to read back what it grants, then write the screen.

```tsx
import { useMemo } from 'react';
import { createPublicClient } from '@adminiumjs/public-client';
import { useCustomer, type CustomerConfig } from '@adminiumjs/adminium/side';

export function App() {
  const loaded = useCustomer();
  if (loaded.state === 'loading') return <p>Loading…</p>;
  if (loaded.state === 'error') return <p>{loaded.message}</p>;
  return <Menu config={loaded.value} />;
}

function Menu({ config }: { config: CustomerConfig }) {
  const client = useMemo(() => createPublicClient(config), [config]);
  const items = config.tables['items'] ?? 'items';
  // client.list(items, { limit: 50 })                     → { data: rows }, in key order
  // client.create(requests, { message })                  → the new row, as far as `select` shows it
  return null;
}
```

`config.tables` maps each table's short name to the name its public endpoint goes by on this
install. The client also signs guests in, opens a guest's own rows, reads free and full times, and
more; see [An app's public access](/guides/apps/public-access/) and
[A person and their own rows](/guides/apps/identity-and-own-links/).

Until someone allows the app's public access, no key is served and `useCustomer()` answers `error`
with a sentence saying so.

Five things a customer screen needs that the example above leaves out:

- **A list comes in key order, and the caller cannot change it.** An app's public endpoint takes
  `limit`, `offset` and `cursor`, and refuses a sort, a filter or a search of the caller's
  (`order`, `where`, `q`) with `400 PUBLIC_QUERY_REFUSED`. Sort the rows in the screen. To keep
  rows out of the public list, write `filters` on the entry in `access.json`: that is decided by
  the app, not by whoever calls.

- **`createPublicClient` may return `null`**, when it is given no address or no key. Check for it
  and show a "not connected" line.
- **The venue's clock and money come from the client**, not from `useCustomer()`:
  `await client.config()` gives `timezone` and `currency`, and `await client.now()` gives the
  server's time, so "today" is right on a device whose clock is wrong.
- **A public error's `message` is for developers, not for visitors.** Catch `PublicApiError`, read
  its `code`, and say your own sentence. This is the opposite of the staff side, where the
  server's message is written to be shown.
- **The human check is automatic.** When an entry asks for it (`"humanCheck": true` in
  `access.json`), the client solves it in the background and sends again. Pass
  `humanCheck: { refs: [requests] }` to `createPublicClient` to solve it up front for the endpoints
  you know ask for it, and save the refused first try.

What a public create can and cannot hold a stranger to is in
[Limits on a stranger's create](/guides/apps/public-access/#limits-on-a-strangers-create). A rule
you need that is not there, such as "the pickup date is not in the past", can only be checked in
the screen: say so to whoever asked for it.

The public API does not take payments, run a query you write, or run code of yours on the server.
What a customer may do is exactly the list the manifest grants.

## The venue's clock and money

Times belong to the venue, not to whoever is reading. A staff session carries `timezone` (an IANA
zone such as `Europe/Copenhagen`) and `currency`. When the database has no time zone set,
`timezone` is `UTC` and `timezoneIsFallback` is `true`: show a line saying times are in UTC.

Never use the browser's own zone
(`Intl.DateTimeFormat().resolvedOptions().timeZone`): it is the reader's, and it is wrong by a
whole number of hours without anyone noticing. `@adminiumjs/public-client` exports `toTenantDay`,
`toTenantMinutes`, `fromTenantLocal` and `formatTenantMoney` for both sides.

## Looking at a side without Adminium

Give `useStaff` sample rows and open the staff screen with `?demo` in its address. It then holds
those rows in memory and saves nothing. `sampleRows` works out the common sample directives (`@ref`,
`@ago`, `@in`, `@day`) near enough to look at a screen:

```tsx
import { sampleRows, useStaff } from '@adminiumjs/adminium/side';
import sample from '../../seeds/sample.json';

const loaded = useStaff({ demo: sampleRows(sample) });
```

To see a side with real data, run the project: under [`adminium dev`](/projects/apps/#run-it-from-the-folder)
the app is installed from its folder, the side is built on every save and served at
`/apps/<key>/<side>/`, and an open screen reloads by itself when you save. A screen that wants to
keep its state instead calls `stopReloading()` and handles `onAppChanged(listener)` itself.
[`adminium app try`](/reference/cli/#app-try) proves the app installs on a fresh Adminium, and
`adminium app pack` makes the file to install on another one.

## What a served screen may not load

Adminium serves a side under its own content policy, so a screen may load only from the address
it came from:

- **No script, stylesheet or font from another host.** Bundle them: install the package and import
  it, or put the file in the side's folder.
- **No inline script.** The build writes none, and one added by hand would not run.
- **No request to another host.** A side cannot call a third-party API from the browser.
- **Pictures** from the same address, or from a host the operator has listed in
  [`ADMINIUM_CSP_IMG_HOSTS`](/self-hosting/env-vars/).

## Text in other languages

A new app is in English. Wrap text people read in `en()`:

```tsx
import { en } from '@adminiumjs/adminium/side';

<button>{en('Add')}</button>
```

`en()` returns the text unchanged. It is a mark, so that the day the app gains a second language
every string to translate is found by searching for `en(`.

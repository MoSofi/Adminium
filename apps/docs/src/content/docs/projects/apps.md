---
title: An app in your project
description: Keep an app of your own in a project's apps/ folder — a manifest written as small files, optional staff and customer screens, sample data — and check it from the command line.
sidebar:
  order: 6
---

An **app** is a product Adminium hosts: tables in your database, pages in the dashboard, and
optionally screens of its own for staff and for customers. The apps on
[adminium.dev](https://adminium.dev/marketplace) are made this way, and you can make your own in a
[project](/projects/).

An app of yours lives in the project's `apps/` folder, one folder per app, named after the app's
key:

```
my-admin/
├── adminium.config.ts
└── apps/
    └── repairs/
        ├── manifest/
        │   ├── app.json            the app itself: key, name, version, publisher, sides
        │   ├── tables/jobs.json    one file per table
        │   ├── pages/jobs.json     one file per dashboard page
        │   ├── roles.json
        │   ├── access.json         what the customer side may read and write
        │   └── sample.json         names the sample data file
        ├── staff/                  screens for staff (optional)
        ├── customer/               screens for customers (optional)
        └── seeds/sample.json       sample data (optional)
```

## Start one

```bash
npx @adminiumjs/adminium app new repairs --staff --customer
```

[`adminium app new`](/reference/cli/#app-new) writes a small working app: one table, one dashboard
page, one role and six sample rows. `--staff` and `--customer` each add a side with one screen over
that table; leave both out for an app that is its tables and pages alone. Everything it writes is
yours to edit, and nothing is generated again later.

## The manifest, as parts

The [manifest](/reference/manifest/) is the one document that says what the app is. In an app
folder you may write it as a single `manifest.json`, exactly as the reference shows it, or as a
`manifest/` folder of smaller files. Adminium puts the parts together into the same document before
it does anything with them, so nothing about the manifest itself changes — only where each field
is written:

| File in `manifest/` | Holds |
|---|---|
| `app.json` | `manifestVersion`, `key`, `name`, `version`, `publisher`, `license`, `description`, `categories`, `compatibility`, `capabilities`, `frontends`, `navGroups`, `widgets`, and `prefixed` (the manifest's `requiredSchema.prefixed`) |
| `tables/<ref>.json` | One table of `requiredSchema.tables`. The file is named after the table's `ref` |
| `pages/<ref>.json` | One page of `pages`. The file is named after the page's `ref` |
| `roles.json` | `roles`, as the array |
| `access.json` | An object with `publicAccess` and, when the app has them, `publicKeys` |
| `emails.json` | An object with `outbox` and `emailTemplates` |
| `add-ons.json` | `addOns`, as the object |
| `sample.json` | An object with `sampleData` and, when used, `seeds` |
| `settings.json` | `settings`, as the array |
| `option-lists.json` | `optionLists`, as the object |
| `documents.json` | `documents`, as the array |

Only `app.json`, one table and one page are required. A part you do not need is simply not there.
A file that is none of these is an error, so a misspelt name cannot be silently left out, and
keeping both `manifest.json` and `manifest/` is an error too.

## An app you made yourself

An app made in your own project carries the publisher `local`:

```json
"publisher": { "id": "local", "name": "Local" }
```

It installs from a file you upload. Adminium says so where it shows the app — "Made on this
install" — because nobody but you has checked it. Any other publisher but Adminium's own is
refused, an add-on can never be `local`, and a `local` app can neither replace an installed app
from another publisher nor take the key of an app the online catalogue lists.

An app with no screens of its own — tables and dashboard pages only — declares one frontend of
kind `none`:

```json
"frontends": [{ "side": "staff", "kind": "none" }]
```

## Check it

```bash
npx @adminiumjs/adminium app check
```

[`adminium app check`](/reference/cli/#app-check) puts the manifest together and validates it
exactly as an install does. A problem names the file and the field it is in:

```
✗ apps/repairs/manifest/tables/jobs.json: columns.2.type — Invalid option: expected one of "id"|"text"|…
```

It then lists what the customer side may reach. That list comes from `access.json` alone: a table
the app has but does not grant there is out of the customers' reach, whatever the screens try.

`app check` also refuses one thing the manifest's shape allows and an install does not: a table
that anyone may add a row to may not also be one anyone may read, because every row could then be
read by guessing ids. Grant reading and adding on different tables, as the starter does with
`items` and `requests`.

## Try it, then pack it

```bash
npx @adminiumjs/adminium app try
```

[`adminium app try`](/reference/cli/#app-try) proves the app installs. It packs it, starts a fresh
Adminium in a temp folder with an empty SQLite database, and installs the package through the same
routes Studio uses. Then it opens each side, reads a table as the signed-in person, and asks the
public API for what `access.json` grants and for what it does not:

```
✓ the package uploads (repairs-0.1.0.tgz, 9 files)
✓ the table check passes (2 table(s) to create)
✓ it installs: tables, pages, roles
✓ the sample data loads
✓ the staff side is served at /apps/repairs/staff/ (2 file(s) it names)
✓ the customer side can read "items", as access grants
✓ the customer side cannot read "requests", which access does not grant
✓ the customer side cannot read a table outside the app
```

A refusal is printed in the server's own words. Nothing listens on a port, and nothing in your
project or its database is touched.

```bash
npx @adminiumjs/adminium app pack
```

[`adminium app pack`](/reference/cli/#app-pack) writes `.adminium/packs/<key>-<version>.tgz` and
its fingerprint beside it. Install it on any Adminium from **Studio → Hosted apps → Install an
app**: upload the file and paste the fingerprint
([Installing apps](/self-hosting/installing-apps/)). The project's hooks and actions are not part of
the package: they stay in the project.

## Screens of its own

A side is a small browser app in `apps/<key>/staff/` or `apps/<key>/customer/`:

```
apps/repairs/staff/
├── src/main.tsx        where it starts
├── src/…               everything it imports, CSS and images included
├── nav.json            its screens, for the dashboard's sidebar (optional)
└── public/             files served as they are (optional)
```

The manifest declares each side in `frontends`, with `"kind": "spa"`; `app check` refuses a side
that is declared and has no code, and code that is not declared.

```bash
npx @adminiumjs/adminium app build
```

[`adminium app build`](/reference/cli/#app-build) bundles each side with the project's `esbuild`
into `.adminium/build/apps/<key>/<side>/`, which is exactly the folder Adminium serves at
`/apps/<key>/<side>/`. The page it writes carries no inline script, and every asset is addressed
under that mount, so a screen opened at a deep address still finds its files. React comes from the
project's own dependencies.

`nav.json` lists the screens a staff side offers the dashboard's sidebar:

```json
[
  { "id": "jobs", "path": "", "label": "Jobs", "icon": "wrench" },
  { "id": "done", "path": "done", "label": "Done" }
]
```

A `path` never starts with `/`: it is added to wherever the side is opened. `icon` is a
[Lucide](https://lucide.dev) icon name.

### What a side is given

A side imports its plumbing from `@adminiumjs/adminium/side`. The build supplies that module from
the Adminium doing the building, so it always matches the server that serves the side.

A **staff side** runs inside Adminium, as the person who is signed in. It has no key:

```tsx
import { useStaff } from '@adminiumjs/adminium/side';

const loaded = useStaff();
if (loaded.state === 'ready') {
  const { rows } = await loaded.value.list('jobs', { order: 'id.desc' });
  await loaded.value.create('jobs', { title: 'Fix the door' });
}
```

`list`, `get`, `create`, `update` and `remove` take a table's short name — the `ref` in its part
file — and act with the signed-in person's own permissions; `can(table, action)` says whether a
button is worth showing. The session also carries `user`, the app's `settings`, the venue's
`timezone` and `currency`. When the database has no time zone set, `timezone` is `UTC` and
`timezoneIsFallback` is true: a screen should say so, and must never use the browser's zone
instead.

A **customer side** is public. `useCustomer()` gives it the browser key Adminium serves and the
address of the [public API](/guides/public-api/endpoints-and-keys/), and the side makes its client
with `@adminiumjs/public-client`:

```tsx
import { createPublicClient } from '@adminiumjs/public-client';
import { useCustomer } from '@adminiumjs/adminium/side';

const loaded = useCustomer();
if (loaded.state === 'ready') {
  const client = createPublicClient(loaded.value);
  const jobs = await client.list(loaded.value.tables['jobs'] ?? 'jobs');
}
```

That client reaches only what `access.json` grants.

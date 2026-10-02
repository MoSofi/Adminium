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

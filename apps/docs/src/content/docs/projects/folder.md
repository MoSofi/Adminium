---
title: The project folder
description: Every file a project holds, what adminium.config.ts can say, how databases are named by key, and what stays in Adminium's own database.
sidebar:
  order: 2
---

```
my-admin/
├── adminium.config.ts     which databases, and the rest of the settings
├── pages/
│   ├── contacts.json      a generated page
│   ├── sales.json         a generated dashboard
│   └── revenue.tsx        a page you wrote
├── schema/
│   └── main.json          labels, hidden columns and masks for database "main"
├── lists/
│   └── stages.json        the answers a column accepts, named once
├── hooks/                 code that runs before or after a record is saved
├── actions/               buttons on records that run your code
├── widgets/               your own table cells and dashboard cards
├── .env                   the secret and your database URLs — never committed
├── .env.example           the same keys, empty, for whoever clones this
├── .adminium/             build output (gitignored)
├── data/                  Adminium's own database and uploads while you develop
├── Dockerfile             this project on the official Adminium image
├── tsconfig.json
├── README.md
└── package.json           @adminiumjs/adminium, pinned to one exact version
```

`pages/`, `schema/`, `lists/`, `hooks/`, `actions/` and `widgets/` are all
optional: a project with none of them still runs, and the first `npm run dev`
fills the first two in.

## `adminium.config.ts`

```ts
import { defineConfig, env } from '@adminiumjs/adminium';

export default defineConfig({
  databases: {
    main: { url: env('DATABASE_URL') },
  },
});
```

`env('NAME')` reads an environment variable when the config loads, with an
optional fallback: `env('DATABASE_URL', 'sqlite:./data/dev.db')`. Keep passwords
out of this file — it is committed — and let `env()` read them from `.env` or
from the host.

Everything here maps onto an environment variable, and **a variable that is
already set wins**, so a host's settings always override the file:

| Setting | | Variable it stands for |
|---|---|---|
| `databases.<key>.url` | The database the admin is built from ([below](#several-databases)) | — |
| `server.port` | Port to listen on. Default 4600. | `PORT` |
| `server.host` | Address to bind. Default `0.0.0.0`. | `HOST` |
| `metaStore.url` | Adminium's own database. Unset means a SQLite file in the data folder. | `ADMINIUM_META_URL` |
| `dataDir` | Where Adminium keeps its own files, relative to the project. Default `data`. | `ADMINIUM_DATA_DIR` |
| `storage.url` | Where uploads and exports go. Unset means the data folder. | `ADMINIUM_STORAGE_URL` |

Nothing else belongs in it: `ADMINIUM_SECRET` and every other variable stay in
the environment. The full list is
[Environment variables](/self-hosting/env-vars/).

`.mts`, `.js` and `.mjs` config files work too. The project is the nearest
folder, from the current one upwards, that holds one — or the folder
`ADMINIUM_PROJECT_DIR` names, which is how the
[project image](/projects/deploy/) points a server at a folder it does not run
from.

## Several databases

Each key under `databases` is one connection, and the key is the name your
files use:

```ts
export default defineConfig({
  databases: {
    main: { url: env('DATABASE_URL') },
    billing: { url: env('BILLING_DATABASE_URL') },
  },
});
```

A key is lowercase letters, digits and `-`, starting with a letter. Files then
say `"database": "main"` rather than a connection id, which is why the same
files work on your laptop and on a server.

| What you do | What happens |
|---|---|
| Add a key | The next start connects it, reads its schema and generates its pages. A database that already has page files is only read: its pages come from the files. |
| Change its URL | The stored connection string is updated, still encrypted. |
| Leave the URL empty | The project starts without it: *Database "billing" has no URL yet. Set it in .env (or the environment) and restart.* |
| A URL that does not answer | The connection is kept in an error state and the boot continues; the next start tries again. |
| Remove a key | Nothing is deleted. Every start says the connection is no longer in the project config, and you remove it in Studio if you meant to. |
| Add a database in Studio | It has no key, so its pages stay in Adminium's database only, and Studio says so. Add it to `adminium.config.ts` to keep its pages in the project. |

## `.env`

`new` writes two values:

```bash title=".env"
ADMINIUM_SECRET=…
DATABASE_URL=postgres://user:password@localhost:5432/shop
```

`ADMINIUM_SECRET` derives the key that encrypts every stored connection string
and API key. Keep a copy somewhere safe and never change it: without it, those
values cannot be decrypted. Each server keeps its own.

`dev`, `start`, `build`, `check` and `pull` all read `.env` from the project
root. A variable already set in the environment wins, and an empty value counts
as unset. `.env` is gitignored; `.env.example` is committed, so whoever clones
the repo knows which keys to fill in.

## `data/`

Adminium's own state while you develop: the embedded SQLite database
(`data/meta.db`), uploads, exports and installed packages. It is gitignored, and
it is not something to copy to a server — a server gets
[its own data folder or a real meta store](/projects/deploy/).

## `.adminium/`

What `npm run build` writes, and what `npm start` runs: the compiled config,
your hooks and actions bundled for the server, your pages and widgets bundled
for the browser, and a manifest recording the Adminium version and a hash of
every input. It is gitignored — build it on the machine that deploys, as the
Dockerfile does.

## `package.json`

```json
{
  "scripts": {
    "dev": "adminium dev",
    "build": "adminium build",
    "start": "adminium start",
    "check": "adminium check",
    "pull": "adminium pull"
  },
  "dependencies": { "@adminiumjs/adminium": "0.3.1" },
  "devDependencies": { "esbuild": "^0.28.0", "@types/react": "^19.2.0" }
}
```

| Command | |
|---|---|
| `npm run dev` | Run it, with the folder and Studio in step |
| `npm run build` | Compile the config and your code into `.adminium/build/` |
| `npm start` | Run the build, the way a server does |
| `npm run check` | [Check](/projects/pull-and-check/#check) the project without starting it |
| `npm run pull` | [Write pages](/projects/pull-and-check/) into the folder |

The Adminium version is **exact**, not a range, so the project moves to a new
release only when you say so — see
[upgrading](/projects/deploy/#upgrading-adminium). `esbuild` builds your config
and code; `@types/react` is only for your editor, because your pages render with
the dashboard's own React.

## What to commit

Everything except the four the template already ignores: `node_modules/`,
`data/`, `.adminium/` and `.env`.

## What is in the folder, and what is not

| In the folder | In Adminium's database |
|---|---|
| Pages and dashboards (`pages/`) | Users, roles and grants |
| Schema customizations (`schema/`) | Settings, including email and branding |
| Your hooks, actions, pages and widgets | Saved views and personal dashboard layouts |
| The config, the Dockerfile, `.env.example` | Email and report templates, automations |
| Option lists (`lists/`) | Installed apps and add-ons, the audit log, jobs |

The split is deliberate: the folder holds what a developer reviews in a pull
request, and the database holds what people change while using the admin.
[`adminium export-zip`](/self-hosting/export-zip/) still carries the whole
instance when you need to move one.

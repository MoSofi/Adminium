---
title: Quickstart
description: Create a project with npx @adminiumjs/adminium new, run it with npm run dev, and have an admin panel on your own schema in a few minutes.
sidebar:
  order: 2
---

```bash
npx @adminiumjs/adminium new my-admin
cd my-admin
npm run dev
```

That is the whole install. The first command creates a folder — a
[project](/projects/) — with one config file and Adminium pinned to an exact
version; the third starts the admin at `http://localhost:4600`, generates your
pages from the database, and writes them into the folder as files you can edit
and commit.

:::caution[The npm package is `@adminiumjs/adminium`]
Always the **scoped** name. The binary it puts on your `PATH` is called
`adminium`, but the unscoped npm name belongs to an unrelated project, so
`npx adminium` installs someone else's package: never run it.
:::

## What you need

- **Node.js 22.14 or newer** (`node -v`).
- A database you can reach — PostgreSQL, MySQL/MariaDB or SQLite — or neither,
  and take the sample database instead. You can also
  [import a schema file](/guides/schema-import/) and connect nothing at all.

## 1. Create the project

```bash
npx @adminiumjs/adminium new my-admin
```

It asks which database the admin should be built from — the sample one, your
own URL, or one you add later — writes the folder, puts a fresh `ADMINIUM_SECRET` and your
database URL in `.env`, starts a git repository and installs the dependencies:

```
Created my-admin.
  Added:       package.json, adminium.config.ts, tsconfig.json, .env.example, …
  Wrote:       .env (ADMINIUM_SECRET), .env (DATABASE_URL)

Next:
  cd my-admin
  npm run dev
```

`--sample --yes` answers both questions up front. In a folder you already have,
run `new` with no name and it adds itself to that folder without changing a
file: [Create a project](/projects/).

:::danger[Keep the secret]
`ADMINIUM_SECRET` derives the key that encrypts every stored connection string
and API key. Store it as you would a database password. If you lose it, those
values cannot be decrypted and must be entered again; each server keeps its own.
:::

## 2. Run it

```bash
cd my-admin
npm run dev
```

```
Database "main": added (postgres://…).
Database "main": generated 20 page(s).
Wrote schema/main.json.
Wrote pages/contacts.json.
…
Adminium is running at http://localhost:4600
```

Open that URL and create the first super admin. You now have list views with
filters and inline edit, detail pages that follow your foreign keys, dashboards,
roles and an audit log — and a folder that describes all of it.

`npm run dev` watches the folder: a page file you save is applied at once, a
change made in Studio is written back to its file, and your own code is rebuilt
and reloaded without a restart. Ctrl-C stops it.

## 3. Change something

Rename a column in Studio, then look at `git diff`: the page's file changed, and
only the lines you touched. Or edit the file yourself —

```json title="pages/contacts.json"
{ "name": "mrr_amount", "label": "MRR", "format": "currency" }
```

— and the open page follows. That round trip is the point of a project:
[Page files](/projects/page-files/) explains all of it, including what happens
when a page is edited on a live server.

## 4. Then

- [Connect another database](/getting-started/first-connection/), or
  [edit your schema](/guides/schema/editing-your-schema/) — labels, masks,
  hidden columns, relations the database never declared.
- [Hooks and actions](/projects/hooks-and-actions/) — run your own code when a
  record is saved, and put buttons on records.
- [Pages and widgets](/projects/pages-and-widgets/) — write a page, a table cell
  or a dashboard card in React.
- [Deploy a project](/projects/deploy/) — Docker, Render, Fly.io, App Platform,
  Railway or a plain VPS.

## Try it without a project

To look at Adminium with nothing to create first:

```bash
npx @adminiumjs/adminium try
```

`try` is the interactive setup wizard. It asks whether to continue in your
browser (recommended) or in the terminal, and then walks through:

1. **Meta placement** — where Adminium's own `adminium_*` tables live. Press
   Enter for the embedded SQLite store under your data directory; it tells you
   it did. See [Where to put the meta store](/self-hosting/meta-store/).
2. **Source** — the engine and either a full DSN or host/port/user/password
   fields.
3. **Test** — a live probe reporting latency, server version, and whether your
   role is read-only.
4. **Tables** — which to include. Blank or `all` takes everything.
5. **Intent** — full admin, read-only analytics, CRUD or support console. This
   shapes what gets generated.

Then it introspects, generates and starts the server. Its data goes to
`~/.adminium`, and `adminium new --import ~/.adminium` turns it into a project
later without losing anything.

:::note[The wizard needs a TTY]
`try` refuses to run non-interactively — there is nothing useful it could do
with unanswerable questions. In CI, containers and systemd, configure through
the environment and run [`adminium start`](#run-a-server-without-a-project).
:::

## Run a server without a project

`start` boots against whatever the environment configures, applies pending meta
migrations first, and asks nothing:

```bash
export ADMINIUM_SECRET=$(openssl rand -hex 32)
export ADMINIUM_META_URL='postgres://adminium:secret@meta-db:5432/adminium_meta'
export ADMINIUM_DATA_DIR=/var/lib/adminium
export PORT=4600

adminium migrate   # optional; start does this too
adminium start
```

Connections are then added through Studio or the REST API. Every variable:
[Environment variables](/self-hosting/env-vars/).

**On a server, pin the version.** With no version in the spec, `npx` checks the
registry on every run and installs any newer release it finds — and with no
terminal attached it does so without asking. `start` then migrates the meta
store to that release, and the version you meant to run refuses to start against
it. Write the version into the command
(`npx @adminiumjs/adminium@0.3.2 start`), or install it into a fixed directory
as in [A VPS without Docker](/self-hosting/vps/). A project has this problem
solved already: its `package.json` pins one exact version.

## Run from a source checkout

Useful for contributing, or to pin to an unreleased commit:

```bash
git clone https://github.com/MoSofi/Adminium.git
cd Adminium
pnpm install
pnpm build
```

The CLI entry point is `apps/server/dist/cli/index.js`. This page and the
[CLI reference](/reference/cli/) write `adminium` for brevity — set an alias:

```bash
alias adminium="node $PWD/apps/server/dist/cli/index.js"
```

It needs **pnpm 10** (`corepack enable`) as well as Node 22.14+. Everything else
on this page then works the same way. More:
[Monorepo setup](/contributing/).

## Where things are stored

| What | Where | Override |
|---|---|---|
| Adminium's own tables | The meta store | `ADMINIUM_META_URL`, or `--meta-url` |
| Files, exports, the embedded SQLite meta store | `data/` inside a project, else `~/.adminium` | `ADMINIUM_DATA_DIR`, or `--data-dir` |
| Pages and schema customizations | The meta store — and, in a project, `pages/` and `schema/` | — |
| The encrypted meta DSN, when you ask the wizard to remember it | `<data-dir>/adminium.json` | — |

The meta DSN cannot live inside the meta store it points at, so when the wizard
offers to remember your choice it writes it to `adminium.json`,
AES-256-GCM-encrypted under `ADMINIUM_SECRET`.

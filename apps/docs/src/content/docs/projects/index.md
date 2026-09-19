---
title: Create a project
description: A project is a folder you open, edit and commit. Create one with adminium new, run it with npm run dev, and your generated pages become files beside your own code.
sidebar:
  order: 1
---

A **project** is a folder you own: your generated pages as files, your own
buttons, save hooks and table cells beside them, and one config file that says
which databases the admin is built from. You open it in an editor, commit it to
git, and deploy it like any other Node app.

Nothing about how Adminium works changes. It still reads your schema and draws
the admin from it — the pages are settings, not generated code. A project just
keeps those settings in your repository instead of only in Adminium's database.

You do not need one. [`adminium try`](#try-it-without-a-project), the
[Docker image](/getting-started/docker/) and the
[desktop app](/desktop/) keep Adminium entirely in its own database, which is
the right choice if nobody is going to write code. Use a project when you want
to review changes in a pull request, run the same admin on a laptop and on a
server, or add code of your own.

:::note[From 0.3.0]
`adminium new`, `dev`, `build`, `check`, `pull`, `eject` and `try` arrive in
0.3.0. Earlier releases have no project mode.
:::

## What you need

- **Node.js 22.14 or newer** (`node -v`).
- A database Adminium can reach — PostgreSQL, MySQL/MariaDB or SQLite — or
  neither, and take the sample database instead.

## One command

```bash
npx @adminiumjs/adminium new my-admin
```

It asks which database the admin should be built from:

```
Which database should the admin be built from?
  › The sample database     a small demo company, in SQLite
    My own database         a Postgres, MySQL or SQLite URL
    Decide later            set DATABASE_URL in .env
```

Then it writes the folder, puts a fresh `ADMINIUM_SECRET` and your database URL
in `.env`, starts a git repository, and installs the dependencies with the
package manager you ran it with:

```
Created my-admin.
  Added:       package.json, adminium.config.ts, tsconfig.json, .env.example, …
  Wrote:       .env (ADMINIUM_SECRET), .env (DATABASE_URL)

Next:
  cd my-admin
  npm run dev
```

`--sample`, `--database <url>` and `--yes` answer the questions up front, which
is what you want in a script:

```bash
npx @adminiumjs/adminium new my-admin --sample --yes
```

Every flag: [`adminium new`](/reference/cli/#new).

## Run it

```bash
cd my-admin
npm run dev
```

Open `http://localhost:4600` and create the first super admin. On this first
run Adminium connects the database, reads its schema, generates the pages — and
writes them into your folder:

```
Database "main": added (postgres://…).
Database "main": generated 20 page(s).
Wrote schema/main.json.
Wrote pages/contacts.json.
Wrote pages/orders.json.
…
```

From here the folder and the running admin stay in step in both directions: edit
`pages/orders.json` and the open page changes; rename a column in Studio and the
file changes. That is [page files](/projects/page-files/).

`npm run dev` restarts when `adminium.config.ts` or `.env` changes, and reloads
your [hooks, actions](/projects/hooks-and-actions/),
[pages and widgets](/projects/pages-and-widgets/) without a restart. Ctrl-C
stops it.

## In a folder you already have

Run `new` with no name and the current folder becomes the project:

```bash
cd my-app
npx @adminiumjs/adminium new
```

It changes nothing that is already there. Missing files are added, and

- `package.json` keeps every value it has; Adminium's dependency and its
  `dev`, `build`, `start`, `check` and `pull` scripts are added. A script name
  you already use is kept, and Adminium's goes in as `adminium:dev` and so on.
- `.gitignore` gets the lines it is missing, appended.
- `.env` is created if it is missing. If it exists, only missing keys are
  added, and `ADMINIUM_SECRET` is never touched.

It asks first when the folder is not empty, and refuses your home folder, the
filesystem root, and a folder that is already a project.

## From an instance you already run

If you have been using Adminium without a project, `new` adopts it rather than
starting over. A `data/` folder holding an instance is kept as it is, and
`--import` copies one in first — `~/.adminium` is where
[`try`](#try-it-without-a-project) puts an instance started from a folder of its
own:

```bash
mkdir my-admin && cd my-admin
npx @adminiumjs/adminium new --import ~/.adminium
```

What happens:

- **The secret is kept.** `new` takes `ADMINIUM_SECRET` from `.env` or the
  environment, or asks for it, and checks that it opens the instance's stored
  connection strings before it writes anything. Without the right secret it
  stops.
- **Each connection gets a key.** The oldest becomes `main`, the others are
  named after the connection. `adminium.config.ts` lists them, each reading its
  URL from `.env` (`DATABASE_URL`, then `<KEY>_DATABASE_URL`).
- **Those variables start empty.** The URLs stay where they are, encrypted, in
  the instance; `new` never writes a password into a file. Fill them in when you
  want the config to be the source.
- **Its pages and schema customizations are written** to `pages/` and
  `schema/`, so what you already built is in the folder from the first commit.

Users, roles, settings, saved views and the audit log stay in the instance's
own database, as they do in every project.

## Try it without a project

```bash
npx @adminiumjs/adminium try
```

`try` is the interactive setup wizard with no folder to create: it asks whether
to continue in your browser or in the terminal, walks through connecting a
database and generating the admin, and starts the server. Its data goes to
`~/.adminium`, unless you started it in a folder that is a project of some other
kind (one with a `package.json`, a `.git` or a compose file), where it uses
`./data` beside it. You can adopt either later with `new --import` above. `try`
needs an interactive terminal, and it refuses to run inside an Adminium
project — there, `npm run dev` is the command.

## Next

- [The project folder](/projects/folder/) — every file, and what
  `adminium.config.ts` can say.
- [Page files](/projects/page-files/) — the format, and how the folder and a
  running server stay in step.
- [Hooks and actions](/projects/hooks-and-actions/) — your own code on the
  server.
- [Pages and widgets](/projects/pages-and-widgets/) — your own React pages,
  table cells and dashboard cards.
- [Pull and check](/projects/pull-and-check/) — bring edits made on a server
  back into the folder, and check the project in CI.
- [Deploy a project](/projects/deploy/) — Docker, Render, Fly.io, App
  Platform, Railway, or a plain VPS.

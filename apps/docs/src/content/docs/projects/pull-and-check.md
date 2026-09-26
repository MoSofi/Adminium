---
title: Pull and check
description: Bring pages edited on a running server back into the project with adminium pull --from, and check the whole project in CI with adminium check — no database needed.
sidebar:
  order: 4
---

Two commands keep a project honest: `pull` brings changes made on a server back
into the folder, and `check` tells you the folder is deployable before you
deploy it.

## Pull

Somebody with admin rights renames a column on the live admin. The server keeps
that edit and marks the page **changed on server** — a deploy of the older file
will not overwrite it. To get it into the project:

```bash
npm run pull -- --from https://admin.example.com
```

It writes only what changed there: the pages edited on that server, the pages
created there, and the pages it deleted (their files are removed). Then you
review it like any other change:

```bash
git diff
git commit -am "pull the label changes from the live admin"
```

Deploy, and the flags clear by themselves: once the deployed files match what
the server has, there is nothing left to pull. A page that changed on **both**
sides comes back as the server's copy, so `git diff` shows you exactly what to
merge.

`pull` never changes the server.

### The API key it needs

`--from` reads the server over its API, so it needs a key:

1. In the live admin, open **API keys** and create one. Its role must have
   *Read pages and schema changes for a project pull* — the built-in **Admin**
   and **Super Admin** roles have it. The key is shown once.
2. Put it in `.env` (or the environment) as `ADMINIUM_API_KEY=adm_sk_…`.

The key may be read-only in every other respect; this one permission is all
`pull` uses.

### Without `--from`

```bash
npm run pull
```

writes every page and schema file from the project's **own** database — the one
`npm run dev` uses. It is how [adopting an instance](/projects/#from-an-instance-you-already-run)
fills the folder, and a way to start over if you have deleted files you want
back. A file the database has not seen yet is left alone; the next `dev` applies
it.

## Check

```bash
npm run check
```

```
✓ adminium.config.ts is valid
✓ the settings the server starts with are valid
✓ database "main" has a usable URL
✓ 20 page file(s), 1 schema file(s) and 2 list file(s) are valid
✓ 2 hook(s) and 1 action(s) load
✓ the Dockerfile builds on @adminiumjs/adminium 0.3.4, the version package.json installs
```

It checks, without connecting to anything:

- `adminium.config.ts` loads and is valid, and the settings a server would
  start with are valid;
- every database URL parses;
- every page, schema and list file is valid, names only databases the config
  lists, and holds no id from one install — including that every rule naming
  an option list names one this project carries, or a built-in;
- `.adminium/build` was made by this Adminium version;
- every hook and action loads and names a database the config lists;
- your pages and widgets build, and every widget a page file names exists and
  is of the right kind — a cell on a table column, a card on a dashboard;
- the `Dockerfile`'s image tag equals the Adminium version `package.json`
  installs.

It exits **2** when something is wrong, naming the file and the field. A missing
`ADMINIUM_SECRET` or an unset database URL is only a warning, because CI usually
has neither:

```
! ADMINIUM_SECRET is not set; `adminium start` needs it (put it in .env).
! database "main" has no URL yet; set it in .env.
```

### In CI

```yaml title=".github/workflows/check.yml"
name: check
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
```

No database, no secret, no services. `npm ci` is needed because `check` builds
the config and your code with the project's own `esbuild`.

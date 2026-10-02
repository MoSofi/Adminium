---
title: CLI reference
description: Every adminium command and flag — new, dev, build, start, check, pull, eject, try, migrate, introspect, generate-prompt, apply-llm-response, export-zip, import-zip.
---

```
adminium [command] [options]
```

Run with **no command** to create a project: it asks for a folder name and runs
[`new`](#new). Inside a project, it lists the project's commands instead. The
setup wizard that used to run here is now [`try`](#try).

On npm the CLI is published as **`@adminiumjs/adminium`** — the scoped name is
the only correct install spec (`npx @adminiumjs/adminium`); the binary it
installs is `adminium`. The unscoped npm name `adminium` is an unrelated
third-party package, so never run `npx adminium`.

On a server, add the version (`npx @adminiumjs/adminium@0.3.13 start`). Without
one, npx installs any newer release it finds, and with no terminal attached it
does so without asking. See
[A VPS without Docker](/self-hosting/vps/) for a pinned install under systemd,
and [Deploy a project](/projects/deploy/) when the server runs a project — a
project pins its version in `package.json` and does not have this problem.

You can also run the CLI from a
[source checkout](/getting-started/quickstart/#run-from-a-source-checkout)
(`node apps/server/dist/cli/index.js`) or through the
[Docker image](/getting-started/docker/), whose entrypoint is the same CLI.

CLI subcommands call the same services the Studio's HTTP routes call — one code
path, two front doors. A run created by `generate-prompt` is the same kind of row
the Studio creates; an introspection from the CLI is the same snapshot.

## Global options

| Flag | |
|---|---|
| `-h`, `--help` | Show help. `adminium <command> --help` for one command. |
| `-v`, `--version` | Show the version |

## Environment

| Variable | |
|---|---|
| `ADMINIUM_SECRET` | **Required.** Derives the key encrypting stored DSNs and API keys. |
| `ADMINIUM_META_URL` | Meta store DSN (`postgres://`, `mysql://`, `sqlite:<path>`) |
| `ADMINIUM_DATA_DIR` | Writable data directory (default `./data` inside a project, else `~/.adminium`) |
| `PORT`, `HOST` | Listen address (default `4600`, `0.0.0.0`) |
| `ADMINIUM_PROJECT_DIR` | The project folder, for a command run from outside it. It must hold `adminium.config.ts`. The project's Dockerfile sets it. |
| `ADMINIUM_API_KEY` | The API key [`pull --from`](#pull) reads a server with |

**Flags override the environment.** Full list:
[Environment variables](/self-hosting/env-vars/).

## Exit codes

| Code | |
|---|---|
| `0` | Success |
| `1` | Error — usage, unreachable database, missing file, bad configuration |
| `2` | `apply-llm-response`: validation failed. `check`: the project has a problem. |
| `3` | `apply-llm-response`: nothing accepted |
| `78` | Refused to start because of the environment |

`2` and `3` are a published contract, meaningful only for
[`apply-llm-response`](#apply-llm-response) and, for `2`, [`check`](#check).

`78` is sysexits(3)'s `EX_CONFIG`: the setup is in a state Adminium will not act
on — a meta store migrated by a **newer** Adminium (a rollback), a pre-upgrade
snapshot that could not be written, or a Node version too old to load the
database driver. Re-running cannot fix any of them, so a supervisor should stop
rather than retry:
[`RestartPreventExitStatus=78`](/self-hosting/vps/). Everything else uses
`0` / `1`.

---

## Project files

A project keeps its pages and schema customizations as files, beside
`adminium.config.ts`. This is the short version;
[Page files](/projects/page-files/) is the long one:

| File | What it holds |
|---|---|
| `pages/<address>.json` | One page: its template, title, data source, place in the sidebar and settings. The file name is its address, `/p/<address>`. |
| `schema/<database>.json` | One database's customizations: labels, hidden and excluded tables and columns, masks and relations, and who set each. |
| `hooks/<name>.ts` | Code that runs before or after a record is saved. See [Hooks and actions](/projects/hooks-and-actions/). |
| `actions/<id>.ts` | A button on records that runs your code. |
| `pages/<address>.tsx` | A page written in React, at `/p/<address>`. See [Pages and widgets](/projects/pages-and-widgets/); [`eject`](#eject) turns a page file into one. |
| `widgets/<name>.tsx` | A table cell or dashboard card written in React, which page files use as `project.<name>`. |

Files name a database by its key in `adminium.config.ts` (`"database":
"main"`) and never hold an id from one install, so the same files work on
every machine. Each file's `"$schema"` points at a JSON Schema in the
installed package, so an editor can complete it. Pages that installed add-ons
and apps bring are not written to files.

In [`dev`](#dev) the files are the master copy. On a server they change only
with a deploy: [`start`](#start) applies them, and pages edited in Studio there
are kept until you [`pull`](#pull) them.

---

## `new`

```
adminium new [name] [--database <url> | --sample | --import <folder>] [--yes]
```

Creates a [project](/projects/): a folder you open, edit and commit. With a
name, it creates `<name>/`, which must not exist yet or must be empty. Without
one (or with `.`), the current folder becomes the project.

In the current folder nothing that exists is changed. Missing files are added,
`package.json` and `.gitignore` are added to, and when the folder already has
`dev`, `build`, `start` or `check` scripts, Adminium's go in as `adminium:dev`
and so on. It refuses your home folder, the filesystem root, and a folder that
is already a project.

It then writes `.env` with a new `ADMINIUM_SECRET`, starts a git repository,
installs the dependencies with the package manager that ran it, and prints what
to run next.

A folder whose `data/` already holds an Adminium instance keeps it, and
`--import` copies one in first (`~/.adminium` after [`try`](#try), for
example). Its secret is never replaced: `new` takes it from `.env` or the
environment, asks for it, or stops, and it checks that the secret opens the
instance's stored connection strings before changing anything. The instance's
connections become the project's databases: the oldest is `main`, the others
are named after their connection. `adminium.config.ts` lists them, each
reading its URL from `.env` (`DATABASE_URL`, then `<KEY>_DATABASE_URL`). Those
variables start empty, because the URLs stay stored, encrypted, in the
instance. Its pages and schema customizations are written to `pages/` and
`schema/`.

| Flag | Default | |
|---|---|---|
| `--database <url>` | asked, or none | The database the admin is built from, written to `.env` as `DATABASE_URL` |
| `--sample` | | Create a small demo company database (SQLite) and use it |
| `-y`, `--yes` | | Answer every question with its default |
| `--no-install` | | Do not install dependencies |
| `--no-git` | | Do not start a git repository |
| `--package-manager <name>` | the one running `new` | `npm`, `pnpm`, `yarn` or `bun` |
| `--import <folder>` | | Copy the instance in this data folder into the project first |
| `--adminium <spec>` | this version | Adminium to install: a version, or a tarball path |

`--database` and `--sample` are refused for an existing instance, which brings
its own databases.

The project gets:

| File | |
|---|---|
| `adminium.config.ts` | Which databases the admin is built from, and other settings |
| `.env`, `.env.example` | The secret and the database URLs. `.env` stays out of git. |
| `package.json` | `@adminiumjs/adminium` pinned to an exact version; `dev`, `build`, `start`, `check` and `pull` scripts; `esbuild`, which builds the project's code, and `@types/react`, for editors |
| `Dockerfile` | Builds the project on the official image, at the same version |
| `tsconfig.json`, `.gitignore`, `.dockerignore`, `README.md` | |

---

## `dev`

```
adminium dev [--port <n>] [--host <addr>]
```

Runs the project: it builds, then runs [`start`](#start) for it. When
`adminium.config.ts`, a file it imports, or `.env` changes, it builds again and
restarts the server. A failed build or a crash does not end it; it waits for
the next change. Stop it with Ctrl-C.

A change to a file in `hooks/` or `actions/`, or to a file one of them
imports, rebuilds only those and swaps them into the running server without a
restart. If they no longer build, the server keeps the ones it has.

A change to a page or widget written in React (`pages/*.tsx`, `widgets/*.tsx`,
or a file they import) rebuilds the browser code, and open dashboards load the
new files and draw them again. A page's state starts over.

A change to a file anywhere under `apps/` checks and rebuilds the
[apps in the project](/projects/apps/#run-it-from-the-folder). The running
server installs a new app, applies a changed manifest in place (the app keeps
serving, and its rows stay), and an open screen of the app reloads. An app that
does not build is named with its file and field, and keeps what it had. What
holds data and was taken out of a manifest is never dropped on the way: Studio
asks.

Under `dev` the public API answers the server's own pages
(`ADMINIUM_PUBLIC_API_ORIGINS` defaults to `self`), and it is switched on when
an app's public access is given, so a customer side works with nothing to set.

The [project files](#project-files) are the master copy while it runs:

- a saved page or schema file is applied at once, and open dashboards reload;
- an edit made in Studio, or by a command such as `apply-llm-response`, is
  written to its file, and a page created or deleted in Studio creates or
  deletes its file;
- deleting a file deletes its page;
- when a file and the database both changed, the file wins, and `dev` says so;
- a file with a mistake is not applied. `dev` names the file and the field, and
  the page keeps its last good version.

The first run of a new project generates pages from its databases and writes
their files. A database that already has page files is only read, and its
pages come from the files.

| Flag | Default | |
|---|---|---|
| `-p`, `--port <n>` | `PORT` or 4600 | Port to listen on |
| `--host <addr>` | `HOST` or 0.0.0.0 | Address to bind |
| `--log-level <level>` | `ADMINIUM_LOG_LEVEL` or info | Server log level |

---

## `design`

```
adminium design [folder] [--port <n>] [--no-open]
```

Opens Adminium Designer in your browser, signed in: describe an app, and a model you choose writes
it into `apps/<key>/` while Adminium checks it, applies it and shows it.

- Outside a project it makes one first, in `folder` (default `my-app`), as `new` would, with a
  database file of its own (`data/app.sqlite`) and no questions.
- The server runs in this process, on this machine only (`127.0.0.1`, whatever `HOST` says), on the
  first free port from 4700 unless `--port` names one. It answers to `127.0.0.1:<port>`,
  `localhost:<port>` and `[::1]:<port>` and nothing else; the preview of what is built is served on
  `localhost`, the Designer itself on `127.0.0.1`.
- The first time, it makes the project's owner with no password. The link it opens signs that
  owner in, once; a second tab or a copied link shows "This link has been used", and running the
  command again makes a new one. Give the owner an address and a password with
  [`owner set`](#owner) before the project runs anywhere else. A project whose owner has a
  password gets no link: sign in as usual.
- The folder is the master copy, as under [`dev`](#dev). Files you change by hand are picked up at
  the Designer's next turn.

`--no-open` prints the link instead of opening the browser. Stop it with Ctrl-C.

## `owner`

```
adminium owner set [--email <address>] [--password-stdin]
```

Gives the owner [`design`](#design) made an email address and a password. Asks for both; with
`--password-stdin` the password is the first line of standard input. Run it inside the project.
It works once: after that the owner changes their password in the dashboard like anyone else.

[`start`](#start) on a project whose owner has no password yet says so and names this command.

## `build`

```
adminium build
```

Compiles `adminium.config.ts` into `.adminium/build/`, which `start` loads, and
records which Adminium version built it. It also bundles each file in `hooks/`
and `actions/`, with the npm packages it imports, into
`.adminium/build/server/`; packages with native code stay imports. Pages and
widgets written in React are bundled for the browser into
`.adminium/build/client/`. Each app under `apps/` is checked, its manifest put
together into `.adminium/build/apps/<key>/app.json`, and its screens built
beside it; a server runs the apps from there and builds nothing. It needs the
`esbuild` dev dependency that `new` adds. Run it before deploying; the
project's Dockerfile runs it in its build stage.

An app that does not build is printed with its problems, and the command exits
`2`; the rest of the project is still built.

It fails, naming the file, when a page file and a React page share an
address (`pages/orders.json` beside `pages/orders.tsx`), when a page or widget
has no default export or its settings are not valid, and when its top-level
code needs a browser.

---

## `check`

```
adminium check
```

Checks a project without starting it, for CI:

- `adminium.config.ts` loads and is valid (it is built first when the build is
  out of date);
- the settings the server would start with are valid;
- every database URL parses;
- every [project file](#project-files) is valid, names only databases the
  config lists, and holds no id from one install;
- `.adminium/build` was made by this Adminium version;
- every built hook and action loads, is valid, and names a database the config
  lists;
- the pages and widgets written in React build, and every page file that names
  a project widget names one that exists, of the right kind: a `cell` widget
  on a table column, a `card` widget on a dashboard;
- each app under `apps/` builds, with each problem named by its file and field;
  an `apps` setting for an app that is not there, and a `database` the config
  does not list, are named too, and an app that declares public access the
  config has not allowed on a server is a warning;
- the Dockerfile's image tag equals the Adminium version `package.json` installs.

Exits `2` when something is wrong, naming the file and field of a broken
project file. It needs no database. A missing `ADMINIUM_SECRET` is only a
warning, since CI usually does not have it.

→ [Pull and check](/projects/pull-and-check/#check), with a GitHub Actions
workflow

---

## `app`

```
adminium app <command> [key] [options]
```

Works on an app in this project's `apps/<key>/` folder — see
[An app in your project](/projects/apps/). `[key]` may be left out when the
project holds one app. `adminium app <command> --help` prints a command's own
options.

### `app new`

```
adminium app new <key> [--name <text>] [--staff] [--customer] [--no-install]
```

Writes a small working app into `apps/<key>/`: two tables, a dashboard page for
each, one role and sample data, with its manifest as part files, a README and a
test file (`node --test apps/<key>/tests/app.test.mjs`). The app carries the publisher `local`. It then runs the same check as
`app check`.

| Flag | Description |
|---|---|
| `--name <text>` | The app's name as people read it. Default: made from the key |
| `--staff` | Add screens for staff in `apps/<key>/staff/` |
| `--customer` | Add public screens for customers in `apps/<key>/customer/`, and an `access.json` that grants them one table |
| `--no-install` | Do not install the packages the screens need |

With a side, `react` and `react-dom` (and `@adminiumjs/public-client` for a
customer side) are added to the project's `package.json` when they are not
there, and the project's package manager installs them. With neither flag the
app is its tables and pages alone, and nothing is installed.

### `app check`

```
adminium app check [key] [--json] [--split]
```

Puts the app's manifest together — one `manifest.json`, or the part files in
`manifest/` — and validates it exactly as an install does, naming the file and
field of each problem. It also checks that the app runs on this Adminium, that
every side the manifest declares has its code in `apps/<key>/<side>/src/`, and
that the sample data fits the app's tables. It ends by listing, table by table,
what the customer side may reach. It needs no database and exits `2` when
something is wrong.

| Flag | Description |
|---|---|
| `--json` | Print the result as JSON: `ok`, the problems with their file and field, and the public access |
| `--split` | Rewrite a single `manifest.json` as a `manifest/` folder of parts. Nothing is written unless the parts compose back to the same manifest |

### `app build`

```
adminium app build [key]
```

Checks the app, then bundles each side in `apps/<key>/<side>/src/`, entered at
`main.tsx`, into `.adminium/build/apps/<key>/<side>/`: an `index.html`, the
script and stylesheet under `assets/` with a hash in their names, files from
the side's `public/` folder as they are, and `surface.json` when the side has a
`nav.json`. It needs the `esbuild` dev dependency and the project's packages
installed. An app with no screens of its own builds nothing.

### `app try`

```
adminium app try [key] [--add-ons <dir>] [--keep] [--json]
```

Packs the app, then proves the package installs and is served. It starts a
fresh Adminium in a temp folder, with an empty SQLite database and nothing
listening on a port, and does what a person does in Studio through the same
routes: uploads the package with its fingerprint, checks the tables, installs,
and adds the sample data. It then:

- reports any page the install had to create empty, because its table cannot
  back its template;
- opens each side and every file its page names;
- reads the app's first table as the signed-in person, and checks the staff
  side is refused to someone who is not signed in;
- asks the public API, with the browser key the customer side is served, for
  each table `access.json` grants to read, and sends an empty row to each it
  grants to add to (which must be refused for its values, not for access);
  then for the tables it does not grant, for a table outside the app, and
  without the key — each of which must be refused.

It prints one line per step and exits `2` when a step fails, with the server's
own words for a refusal. Nothing in your project or its database is changed.
It does not run the screens in a browser, send an email, draw a document or
move a row through its states: open each screen once after installing.

This is `adminium app try`. Plain [`adminium try`](#try) is another command:
the setup wizard for running Adminium without a project.

| Flag | Description |
|---|---|
| `--add-ons <dir>` | A folder of add-on packages (`<key>-<version>.tgz`, each with its `.tgz.integrity`) for an app that requires one |
| `--keep` | Keep the throwaway Adminium's folder, and print where it is |
| `--json` | Print the steps as JSON |

### `app pack`

```
adminium app pack [key] [--out <dir>]
```

Checks the app, builds its sides, and writes `<key>-<version>.tgz` with its
fingerprint in `<key>-<version>.tgz.integrity`, in `.adminium/packs/` unless
`--out` says otherwise. The package holds the manifest as one `manifest.json`,
each built side, and `seeds/`. Packing the same files twice gives the same
bytes. A link or a hidden file in `seeds/` is refused, and so is a package
larger than an upload takes (32 MB). The project's hooks and actions are not
part of an app package.

Install the file from **Studio → Hosted apps → Install an app**: upload it and
paste the fingerprint. See [Installing apps](/self-hosting/installing-apps/).

## `pull`

```
adminium pull [--from <url>]
```

Writes the project's [page and schema files](#project-files).

Without `--from`, from the project's own database: every page and schema file
is written, and the file of a page that no longer exists is deleted. A file the
database has not seen yet is kept; the next `dev` applies it.

With `--from`, from a server running the project: it asks that server for the
pages changed there (`GET /api/v1/project/export`) and writes only those files,
deleting the file of a page deleted there. It reads `ADMINIUM_API_KEY` from
`.env` or the environment: an API key whose role has *Read pages and schema
changes for a project pull* (the built-in Admin role has it). The server is not
changed. Its notes about changed pages clear once the pulled files are
deployed to it.

```bash
npm run pull -- --from https://admin.example.com
```

A page changed both on the server and in your folder comes back as the
server's copy; `git diff` shows what to merge. Neither form changes a page.

| Flag | Default | |
|---|---|---|
| `--from <url>` | | A server running this project |

→ [Pull and check](/projects/pull-and-check/)

---

## `eject`

```
adminium eject <address>
```

Turns a page file into a page written in React: it writes
`pages/<address>.tsx` and deletes `pages/<address>.json`.

```bash
npx @adminiumjs/adminium eject orders
```

The new file holds the page file's settings as a constant, and draws them
with the UI kit's `GeneratedPage`, so the page looks and works as before. From
there it is yours to change; see
[Pages and widgets](/projects/pages-and-widgets/#starting-from-a-generated-page).

The page keeps its address, its place in the sidebar, who can see it and its
saved views: `dev`, or a server's next start, gives the page's row to the new
code instead of deleting it. Regenerating the database no longer changes the
page. To undo, restore the page file and delete the `.tsx` file (with
`git restore` and `git rm`, for example).

It needs no database. It refuses an address that has no page file, one that
is already code, a page file that is not valid, and a page that is turned off.

---

## `try`

```
adminium try [--browser|--terminal] [--port <n>] [--host <addr>]
```

Tries Adminium without a project: walks through connecting a database and
generating an admin app, then starts the server. Its data goes to `./data`
beside a project of another kind, or to `~/.adminium`. `adminium init` is the
same command. It refuses to run inside an Adminium project.

| Flag | Default | |
|---|---|---|
| `--browser`, `--terminal` | asked | Where to continue the setup |
| `--no-open` | | Do not launch a browser; just print the URL |
| `--bridge` | off | Let [adminium.dev](https://adminium.dev/generate/) hand this instance a connection string, for the length of this run. It prints a pairing code the hand-off needs. See [`ADMINIUM_BRIDGE_ORIGINS`](/self-hosting/env-vars/#adminium_bridge_origins). |
| `--log-level <level>` | `ADMINIUM_LOG_LEVEL`, else warn | Server log level once it starts |
| `-p`, `--port <n>` | `PORT` or 4600 | Port to listen on |
| `--host <addr>` | `HOST` or 0.0.0.0 | Address to bind |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN (skips the meta question) |
| `--name <name>` | prompted | Connection name |

Requires an interactive terminal. Non-interactive? Configure via the environment
and run [`start`](#start).

---

## `start`

```
adminium start [--port <n>] [--host <addr>]
```

Boots Adminium against the configured meta store, applying any pending
migrations first. With nothing configured it falls back to an embedded SQLite
meta store under the data directory and says so.

Inside a project, `start` also:

- loads the project's `.env`, where a variable already set in the environment
  wins;
- loads the config from `.adminium/build/`. When that build is missing, out of
  date, or made by another Adminium version, it builds first. Without esbuild,
  a TypeScript config stops there and asks for `npm run build`;
- keeps its data in the project's `data/` folder, unless the config's `dataDir`,
  `ADMINIUM_DATA_DIR` or `--data-dir` says otherwise;
- connects the databases the config lists, and ignores `ADMINIUM_SOURCE_URL`;
- applies the [project files](#project-files). A file changed since the last
  start is applied, unless its page was also changed on this server. That page
  keeps the server's version, and Studio → Pages marks it until you
  [`pull`](#pull) it and deploy. Studio also offers to keep the server copy or
  use the project's. A file with a mistake is not applied, and the log says why;
- loads the project's [hooks and actions](/projects/hooks-and-actions/)
  from the build before it accepts requests. A file that does not load is
  skipped and listed in Studio → Settings → Project;
- installs each [app the build carries](/projects/apps/#on-a-server), or
  applies it again when its manifest changed since the last start, before it
  accepts requests. On a server it gives an app no public access unless
  `adminium.config.ts` allows it, installs no add-on for it, changes no table
  the app did not make, and drops nothing.

The project is the nearest folder, from the current one upwards, that holds
`adminium.config.ts`, or the folder `ADMINIUM_PROJECT_DIR` names.

| Flag | Default | |
|---|---|---|
| `-p`, `--port <n>` | `PORT` or 4600 | Port to listen on |
| `--host <addr>` | `HOST` or 0.0.0.0 | Address to bind |
| `--meta-url <dsn>` | `ADMINIUM_META_URL`, else embedded SQLite | Meta store DSN |
| `--data-dir <path>` | `ADMINIUM_DATA_DIR`, else `./data` inside a project or `~/.adminium` | Data directory |
| `--log-level <level>` | `ADMINIUM_LOG_LEVEL` or `info` | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace` |
| `--static-root <path>` | `ADMINIUM_STATIC_ROOT`, else the bundled build | Serve the dashboard build from this directory |
| `--skip-migrate` | off | Do not apply pending meta migrations on boot |

```bash
adminium start --port 8080 --host 127.0.0.1 --log-level debug
```

---

## `migrate`

```
adminium migrate [--status]
```

Applies any pending `adminium_*` migrations to the meta store, in order. Safe to
re-run: already-applied migrations are skipped via the ledger. `start` and the
setup wizard run this for you; call it directly when you upgrade Adminium in a
deployment that boots against a pre-migrated store.

| Flag | |
|---|---|
| `--status` | List migrations and whether each is applied; apply nothing |
| `--meta-url <dsn>` | Meta store DSN |
| `--data-dir <path>` | Data directory |

```bash
adminium migrate --status
```

```
migration                 applied  note
0001_init                 yes
0007_add_widget_layouts   no
```

The `note` column carries `CHECKSUM DRIFT` (an applied migration no longer
matches this version) or `unknown to this version` (the store was written by a
newer Adminium — you downgraded). Both are alarms:
[Upgrading](/self-hosting/upgrades/).

---

## `introspect`

```
adminium introspect --connection <id> [--out <file>]
```

Reads the source database schema — never its rows — classifies it, and stores a
snapshot. Re-running with an unchanged schema is a no-op: the checksum matches
and no new snapshot is written.

| Flag | Default | |
|---|---|---|
| `-c`, `--connection <id>` | **required** | Connection id to introspect |
| `-o`, `--out <file>` | | Also write the snapshot schema to this JSON file |
| `--timeout <ms>` | `30000` | Introspection budget in milliseconds |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

```bash
adminium introspect --connection prod-db --out schema.json
```

```
Snapshot snp_01HQ8 stored — 24 tables, checksum a3f2c1d90e4b.
Proposed 7 PII mask override(s) — masking is on by default.
Wrote /work/schema.json
```

The `--out` file is [JSON IR](/guides/schema-import/json-ir/), so it re-imports.

---

## `generate-prompt`

```
adminium generate-prompt --connection <id> [--sections <list>] [--locales <list>]
                        [--sampling] [--out <file>]
```

Creates a BYO run from the connection's latest snapshot and writes the prompt.
Paste it into any chat model, save the reply, and feed it back with
[`apply-llm-response`](#apply-llm-response).

Nothing leaves this machine: BYO runs record no provider and no model, and the
prompt carries schema metadata + aggregates only — never your rows, unless you
opt in with `--sampling`.

| Flag | Default | |
|---|---|---|
| `-c`, `--connection <id>` | **required** | Connection id to build the prompt for |
| `--sections <list>` | all sections | Decision groups to request, e.g. `labels,enums,relations` |
| `--locales <list>` | `en_US` | Output locales, e.g. `en_US,de_DE` (`en_US` is always included) |
| `--sampling` | off — sample-free | Opt in to including sampled example values in the prompt |
| `-o`, `--out <file>` | print to stdout | Write the prompt here (chunked runs get `<name>.<n>.<ext>`) |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

Prints the `runId` and a token estimate.
→ [BYO round-trip](/guides/llm-assist/byo-prompt/)

---

## `apply-llm-response`

```
adminium apply-llm-response --run <runId> --file <response.json>
                           [--chunk <n>] [--yes-above <0..1>] [--dry-run]
```

Feeds a saved model reply back into its run: validates it, prints the diff
against the heuristic baseline, and applies the rows at or above the confidence
threshold in one transaction.

Your own edits are never overwritten (`user > llm > heuristic`), and applying the
same run twice writes no duplicates.

| Flag | Default | |
|---|---|---|
| `-r`, `--run <runId>` | **required** | Run id from `generate-prompt` |
| `-f`, `--file <path>` | **required** | The saved model response |
| `--chunk <n>` | unchunked | Which chunk this file answers, for chunked runs |
| `--yes-above <0..1>` | `0.8` | Accept suggestions at or above this confidence |
| `--dry-run` | off | Validate and print the diff; write nothing |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

**Exit codes: `0` applied · `2` validation failed · `3` nothing accepted.**

→ [BYO round-trip](/guides/llm-assist/byo-prompt/)

---

## `export-zip`

```
adminium export-zip [--connection <id>] [--out <file>] [--include-secrets]
```

Bundles the server plus its configuration — connections, snapshots, overrides,
pages and dashboards, views, settings, roles — so it can be restored or replayed
elsewhere.

:::caution[Configuration, not source code]
Adminium interprets configuration at runtime and does not emit a generated app.
There is no source in this bundle. See [Export & restore](/self-hosting/export-zip/).
:::

| Flag | Default | |
|---|---|---|
| `-c`, `--connection <id>` | the whole instance | Export only this connection |
| `-o`, `--out <file>` | `./adminium-export.zip` | Destination archive path |
| `--include-secrets` | off | Include encrypted DSNs and provider keys in the bundle |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

→ [Export & restore](/self-hosting/export-zip/)

---

## `import-zip`

```
adminium import-zip --in <file> [--dry-run]
```

Restores a bundle produced by [`export-zip`](#export-zip) — the other half of the
same flow. The meta-store migrations run first, then every config document is
replayed forward to the version this build understands, so a bundle exported by
an older Adminium imports cleanly.

Resources are matched on natural keys rather than raw ids, so a re-import updates
what is already there instead of duplicating it. Everything happens in one
transaction: a bundle that fails halfway leaves no half-restored instance behind.

| Flag | Default | |
|---|---|---|
| `-i`, `--in <file>` | **required** | Bundle to import |
| `--dry-run` | off | Validate and report; write nothing |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

Trial a restore before committing to it:

```bash
adminium import-zip --in adminium-export.zip --dry-run
```

That reads the archive, checks the manifest, replays and validates every config
document, and prints what *would* be written — without touching the database.

:::note[A bundle from a newer Adminium is refused]
Not partially read. A build that does not understand a document's version would
silently drop the parts it cannot see, and a silent partial restore is worse than
a failed one. Upgrade this instance instead.
:::

If the bundle was exported without `--include-secrets` (the default), connections
that are **new** to this instance import without credentials and need their
connection string entered once. Connections already configured here keep the
credentials they have — a no-secrets bundle has nothing to replace them with, so
it does not try.

→ [Export & restore](/self-hosting/export-zip/)

# Adminium

**From connection string to shipped dashboard.**

Adminium introspects a database — or a schema file — classifies the structure and
relations it finds, and generates a complete, themable React admin dashboard. This
package is the whole product in one install: the Fastify API, the meta-store
migrations, the CLI, and the pre-built dashboard it serves.

Adminium is free and open source under **AGPL-3.0-only**. Source, issues and
releases: <https://github.com/MoSofi/Adminium>.

> **npm naming.** The `@adminium` scope and the unscoped name `adminium` on npm both
> belong to unrelated parties. Adminium publishes under **`@adminiumjs`** — install
> `@adminiumjs/adminium`, never a bare `adminium`. The installed command is still
> `adminium`.

## Install

Create a project and run it:

```sh
npx @adminiumjs/adminium new my-admin --sample
cd my-admin
npm run dev
```

Or install the command globally:

```sh
npm install -g @adminiumjs/adminium
adminium new my-admin
```

Node.js 22.14 or newer is required. On an older Node the CLI stops with a
message saying so.

Running `adminium` with no arguments creates a project: it asks for a folder
name and runs `adminium new`. To try Adminium without a project, run
`adminium try`: it asks for a database connection, probes it, generates the
app, and starts the server on <http://localhost:4600>.

## Commands

| Command | What it does |
|---|---|
| `adminium new [name]` | Create a project folder (or make the current folder one), with `--sample` for a demo database |
| `adminium dev` | Run a project, restarting it when its config or `.env` changes and reloading its hooks, actions, pages and widgets when they change |
| `adminium build` | Compile a project's config, hooks, actions, pages and widgets into `.adminium/build` |
| `adminium check` | Check a project, its page files, hooks, actions, pages and widgets without starting it (for CI) |
| `adminium pull [--from <url>]` | Write a project's page and schema files from its database, or from a server running it |
| `adminium eject <address>` | Turn a page file into a page written in React |
| `adminium try` / `adminium init` | Interactive setup without a project: connect a database, generate the app, start the server |
| `adminium start` | Start the server and serve the dashboard (`--port`, `--host`); inside a project, the project |
| `adminium introspect --connection <id>` | Introspect a connection and store the schema snapshot |
| `adminium migrate [--status]` | Run the meta-store migrations (idempotent) |
| `adminium export-zip` | Export the instance configuration as a runnable bundle |
| `adminium import-zip --in <file>` | Import an instance configuration bundle |
| `adminium generate-prompt` | Build an LLM enrichment prompt (bring-your-own round trip) |
| `adminium apply-llm-response` | Validate an LLM response and apply the accepted suggestions |

`adminium --help`, or `adminium <command> --help`, prints the full flag list.

## Configuration

Everything is environment-driven, validated once at boot.

| Variable | Purpose |
|---|---|
| `ADMINIUM_SECRET` | **Required.** Master secret, ≥16 chars — e.g. `openssl rand -hex 32` |
| `PORT` | Listen port (default `4600`) |
| `HOST` | Bind address (default `0.0.0.0`) |
| `ADMINIUM_META_URL` | Meta-store DSN: `postgres://`, `mysql://`, or `sqlite:<path>` |
| `ADMINIUM_DATA_DIR` | Writable directory for files, exports and backups (default `./data`) |
| `ADMINIUM_LOG_LEVEL` | `trace`…`fatal` (default `info`) |
| `ADMINIUM_TRUST_PROXY` | Enable behind a TLS-terminating proxy |
| `ADMINIUM_TRUSTED_PROXIES` | Addresses that count as that proxy (default `loopback,uniquelocal`) |
| `ADMINIUM_CORS_ORIGINS` | Comma-separated allowed origins |
| `ADMINIUM_BRIDGE_ORIGINS` | Origins allowed to hand this instance a connection string (`--bridge`) |
| `ADMINIUM_NETWORK_FEATURES` | `off` on air-gapped installs — the UI stops offering webhooks/OAuth |
| `ADMINIUM_TELEMETRY` | `off` by default |

A missing or malformed value fails the boot with the fix printed, rather than
starting a half-configured server.

### Databases

Adminium reads your data through **PostgreSQL**, **MySQL/MariaDB** and **SQLite**
adapters. The meta store (Adminium's own `adminium_*` tables) runs on Postgres,
MySQL or an embedded SQLite file; the Postgres and MySQL drivers ship as optional
dependencies, so `--no-optional` yields a SQLite-only install.

## What is inside

This package carries the internal packages the server loads in its own
`node_modules/@adminium/`: `engine`, `meta`, `i18n`, `llm`, `schema-import`,
`manifest`, `add-on-contracts`, `widgets` and the three database adapters. They
are listed in `bundleDependencies`, so npm installs them from this tarball and
never fetches them from the registry, and the compiled `@adminium/*` imports
resolve to those folders. The dashboard ships pre-built in `dashboard/`, so none
of its browser libraries are installed. `schemas/` holds the JSON Schemas that
a project's page and schema files name with `$schema`, and `templates/` the
files `adminium new` writes.

## Related packages

- `@adminiumjs/public-client`: the client app frontends use to call an Adminium
  instance's public API.
- `@adminiumjs/manifest` and `@adminiumjs/add-on-contracts`: the manifest schema
  and the add-on contracts, for add-on hosts.

## Licence

AGPL-3.0-only. The complete corresponding source for this package is at
<https://github.com/MoSofi/Adminium>. See the bundled `LICENSE`.

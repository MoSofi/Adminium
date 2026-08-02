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

```sh
npm install -g @adminiumjs/adminium
adminium
```

Or run it without installing:

```sh
npx @adminiumjs/adminium
```

Node.js 22 or newer is required.

Running `adminium` with no arguments starts the interactive setup: it asks for a
database connection, probes it, generates the app, and starts the server on
<http://localhost:4600>.

## Commands

| Command | What it does |
|---|---|
| `adminium` / `adminium init` | Interactive setup: connect a database, generate the app, start the server |
| `adminium start` | Start the server and serve the dashboard (`--port`, `--host`) |
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

## Related packages

`@adminiumjs/engine`, `@adminiumjs/meta`, `@adminiumjs/widgets`,
`@adminiumjs/charts`, `@adminiumjs/ui`, `@adminiumjs/llm`,
`@adminiumjs/schema-import`, `@adminiumjs/adapter-postgres`,
`@adminiumjs/adapter-mysql`, `@adminiumjs/adapter-sqlite`, `@adminiumjs/i18n`,
`@adminiumjs/tokens`, `@adminiumjs/manifest`.

Their compiled imports use the `@adminium/*` specifiers; the published manifests
alias them (`"@adminium/engine": "npm:@adminiumjs/engine@<version>"`) so a normal
`npm install` resolves everything with no extra configuration.

## Licence

AGPL-3.0-only. The complete corresponding source for this package is at
<https://github.com/MoSofi/Adminium>. See the bundled `LICENSE`.

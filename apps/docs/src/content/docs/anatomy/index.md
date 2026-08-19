---
title: Anatomy of Adminium
description: What actually happens between `npx @adminiumjs/adminium` and a working admin panel — the boot path, the twenty workspaces, the request lifecycle, and where your customizations live.
---

[What is Adminium?](/getting-started/) explains the model: Adminium interprets
your schema at runtime rather than generating a codebase, it keeps three
separate connections, and it reads structure without reading rows. This page
assumes you have that and goes one level down — into the machinery.

It answers, in order: what that one command downloads and runs, how a Node
process becomes an admin panel, which of the twenty workspaces does what, how a
schema turns into pages, what happens on a single click, and where everything
you change is stored.

## 1. What `npx @adminiumjs/adminium` actually runs

One npm package, one binary, no post-install step.

```
npm registry
└── @adminiumjs/adminium@0.2.1        ← the published name of apps/server
    ├── dist/                          compiled server + CLI
    ├── dashboard/                     the pre-built React SPA (static files)
    ├── vocabulary/                    LLM allow-lists snapshotted at pack time
    ├── README.md
    └── LICENSE
```

`bin` maps the command `adminium` to `dist/cli/index.js`. That entry file does
exactly two things: `await runCli(process.argv.slice(2))`, then assign the
result to `process.exitCode`. It never calls `process.exit`, because a clean
exit must not tear down a server that is now listening.

:::caution[The scoped name is the only correct one]
The unscoped npm name `adminium` and the `@adminium` scope both belong to
unrelated parties. Install `@adminiumjs/adminium`; the binary it puts on your
`PATH` is still called `adminium`. Never run `npx adminium`.
:::

The SPA ships **inside** the server tarball. That is the whole reason one
command is a complete install — there is no separate frontend to deploy, no
CDN, no build step on your machine. Two scripts fill those directories before
the package is packed: `bundle-dashboard.mjs` copies `apps/dashboard/dist` into
`apps/server/dashboard`, and `bundle-allowlists.mjs` snapshots the widget
vocabulary into `apps/server/vocabulary`. Neither directory is in git.

### The command set

`runCli` is a pure argv-to-exit-code dispatcher over eight commands, listed here
in registry order — the same order `--help` prints:

| Command | What it does |
|---|---|
| `init` | The interactive setup wizard. **This is what runs with no arguments.** |
| `start` | Boot the server against existing configuration. |
| `migrate` | Apply pending meta-store migrations; `--status` reports without applying. |
| `introspect` | Read a connection's schema into a new snapshot. |
| `generate-prompt` | Emit the LLM enrichment prompt for copy-paste. |
| `apply-llm-response` | Validate and apply a model's reply. |
| `export-zip` | Write the whole instance configuration to a bundle. |
| `import-zip` | Restore one. |

Flags are declared as data (`FlagSpecs`) and `--help` is rendered from that same
data, so a flag that exists is documented and a documented flag exists. Parsing
is Node's built-in `node:util` `parseArgs` in strict mode — no CLI framework,
so the published tarball carries no extra dependency for the first thing you
run.

Exit codes are a closed set of four: `0` success, `1` error, `2` validation
failed, `3` nothing accepted. The last two are meaningful only for
`apply-llm-response`.

### The one required variable

`ADMINIUM_SECRET` is the single hard requirement. It derives, via HKDF-SHA256,
the keys that encrypt every stored DSN and API key. Without it — or with fewer
than 16 characters — startup stops before anything else happens:

```
ADMINIUM_SECRET is required — it derives the key that encrypts every stored DSN and API key.

Generate one and re-run, e.g.
  export ADMINIUM_SECRET=$(openssl rand -hex 32)
```

followed by a `variable | problem | hint` table. Nothing is written to stdout;
the run never starts.

One ordering detail worth knowing: the wizard checks for an interactive terminal
*before* it loads the environment. So a non-interactive `npx @adminiumjs/adminium`
with no secret reports "The setup wizard needs an interactive terminal" and
never mentions the secret. `adminium start` has no such gate, so there the
secret error is the first thing you see.

`envSchema` declares sixteen variables in total. `ADMINIUM_SECRET` is the only
required one; `PORT` defaults to `4600`, `HOST` to `0.0.0.0`, and
`ADMINIUM_DATA_DIR` to the relative `./data`. See
[Environment variables](/self-hosting/env-vars/).

## 2. The first run

With no command, argv routes to the wizard, and the wizard's first question is
which front door you want:

```
How would you like to set this up?
  › In your browser        ← default
    Here in the terminal
```

**The browser door** asks nothing further. It boots the server immediately,
prints the URL, spawns your platform's opener (`open` / `cmd /c start` /
`xdg-open`), and hands the rest of setup to the Studio wizard in the browser.
`--no-open` skips the launch and prints "Open that URL to continue" instead.

**The terminal door** runs the whole flow as a questionnaire: pick an intent →
give a DSN → probe it (`Connected — 41 ms · PostgreSQL 16.2 · read-only role`)
→ enforce meta placement → name the connection → introspect → tick the tables
you want → generate → boot.

A terminal that cannot host a redrawing menu — `TERM=dumb`, piped stdout, most
CI — is not asked at all and takes the **terminal** path, even if you passed
`--browser`. In that environment the first prompt you see is the meta-placement
question, not the front-door question.

Neither door creates your admin account. That happens in the browser, at
`/setup`, via `POST /api/v1/setup/super-admin`. The account is once-only *by
construction*: inside one transaction the server inserts a
`system.superAdminCreatedAt` row into `adminium_settings`, whose `key` is a
primary key, before creating the user. A concurrent second attempt loses the
insert on a duplicate-key violation and rolls back entirely.

### What lands on disk

Everything goes under `ADMINIUM_DATA_DIR` (default `./data`):

- `data/meta.db` — an embedded SQLite meta store, if you configured nothing
  else. This prints a warning on every boot: *"Using embedded SQLite meta store
  at … — set `ADMINIUM_META_URL` for production."*
- `data/adminium.json` — the bootstrap file, written `0600`, holding
  `{ v, metaUrl?, createdAt, instanceId }`. Any `metaUrl` in it is AES-256-GCM
  ciphertext. Written only by the terminal door, only when you chose an external
  meta database.

Where the meta store lives is a strict three-rung precedence:

1. `ADMINIUM_META_URL`
2. the decrypted `metaUrl` inside `data/adminium.json`
3. `sqlite:<dataDir>/meta.db`

## 3. The running process

One Node process. No Redis, no external queue, no separate scheduler, no
sidecar. It is assembled in two layers.

`buildServer()` builds the skeleton: a pino logger with path-based redaction,
`req_`-prefixed request ids, Zod validator and serializer compilers, a global
error envelope, three plugins (**core** → **auth** → **static**), an SPA-aware
not-found handler, and the handful of `/api/v1` namespaces that need no injected
services.

`composeServer()` is the composition root. It takes an already-opened meta
store, a `ConnectionManager`, the LLM services and the widget allow-lists, calls
`buildServer`, registers the RBAC plugin, wires jobs and realtime, and then
registers the remaining route factories under `/api/v1`. Registration order is
load-bearing: the auth plugin's `onRequest` hook must run before the RBAC
plugin's, and the RBAC plugin must be registered before any route that calls
`app.rbac.require` at registration time.

The end result, in one picture:

```
                    ┌──────────────────────────────────────────┐
   Browser ────────►│  one SPA build (@adminium/dashboard)     │
                    │  Studio  +  Generated App                │
                    └────────────────┬─────────────────────────┘
                        REST /api/v1 · WS /ws · SSE /api/v1/events
                    ┌────────────────┴─────────────────────────┐
                    │  @adminium/server — Fastify 5            │
                    │  auth · RBAC · CRUD · jobs · realtime    │
                    └───┬──────────────┬─────────────────┬─────┘
                        │              │                 │
                   @adminium/     @adminium/     adapter-postgres
                     engine          meta          adapter-mysql
                  introspect →    adminium_*      adapter-sqlite
                   classify →       tables
                    generate           │                 │
                                  meta store       your database
```

Three cron schedules are registered at compose time: a telemetry ping
(`0 4 * * *`, with an hour of jitter), a scheduled-reports poll, and an exports
retention sweep (`30 4 * * *`). An `onClose` hook disposes every source-database
pool.

### The three connections, as implemented

| Role | Lifetime | What it may do |
|---|---|---|
| **introspect** | short-lived, created per introspection | reads system catalogs only |
| **data** | a pooled Kysely handle, cached per connection id | the CRUD and widget-data path |
| **meta** | a separate Kysely, never handed to an adapter | Adminium's own tables |

The separation is enforced at the type level, not by convention. The adapter
interface is generic over its role: `introspect()` is typed
`this: DatabaseAdapter<'introspect'>` while the row-reading methods are typed
`this: DatabaseAdapter<'data'>`. Calling one on the other is a compile error,
and every adapter re-checks the role at runtime as well.

## 4. The twenty workspaces

Fifteen packages and five apps, all released together at one version. Source
names are `@adminium/*`; the published names are `@adminiumjs/*` (see
[§10](#10-one-codebase-three-ways-to-run-it)).

This section is the map. For what is actually inside each package — its public
surface, its internal decisions, and the rules that keep it in its lane — see
**[The packages, one by one](/anatomy/packages/)**.

### Packages

| Package | What it is |
|---|---|
| `engine` | The brain. Owns the schema IR, the adapter contract, classification, snapshot hashing/diffing, and page generation. **No database drivers.** |
| `adapter-postgres` | Postgres introspection via `pg_catalog`, plus the Kysely query engine. |
| `adapter-mysql` | MySQL/MariaDB introspection via `information_schema`. Refuses MySQL < 8.0 and MariaDB < 10.5. |
| `adapter-sqlite` | SQLite introspection via `sqlite_master` and `pragma_*` table-valued functions. |
| `meta` | The `adminium_*` tables: 34 tables, 12 migrations, typed repositories. A leaf — depends only on `kysely` and `zod`, and declares no drivers. |
| `schema-import` | Eight schema-file parsers (SQL DDL, Prisma, Drizzle, TypeORM, Sequelize, Rails, Django, JSON IR) producing the same IR. This is how you use Adminium with no live database. |
| `llm` | LLM assist as a headless library: four provider clients, one deterministic prompt builder, a seven-stage response validator. |
| `widgets` | The widget registry — 177 widget definitions across 13 families — plus page templates and the dashboard grid. |
| `ui` | The component library: 66 components on 11 Radix primitives, CVA variants, `ThemeProvider`. Owns no copy; every string arrives as a prop. |
| `charts` | SVG chart primitives. No charting library — `d3-scale` and `d3-shape` for math only, React renders the `<svg>`. |
| `tokens` | Design tokens as CSS custom properties: theme, 8 accents, density, viz palette, motion, self-hosted fonts, and the Tailwind v4 mapping. Zero dependencies. |
| `i18n` | 8 locales × 5 namespaces, ICU messages, RTL derived from the locale registry, split into framework-free / React / Node entry points. |
| `manifest` | The micro-SaaS manifest schema, validator and installer. |
| `add-on-contracts` | The add-on slot registry (11 slots) and provider contracts (3), each shipping a conformance suite an implementation must pass. |
| `config` | Shared tsconfig, Prettier, and the flat ESLint config — including a six-rule in-house plugin. |

### Apps

| App | What it is |
|---|---|
| `server` | The Fastify server and the `adminium` CLI. **This is the published npm package.** |
| `dashboard` | The React SPA — Studio *and* the Generated App in one build. Private; ships as static files inside `server`. |
| `desktop` | The Electron shell. Runs the same server in a `utilityProcess`. |
| `docs` | This site (Astro Starlight). |
| `e2e` | The Playwright matrix. |

### The dependency graph

Runtime dependencies only, `A → B` meaning *A depends on B*:

```
tokens             →  (nothing)
i18n               →  (nothing)
meta               →  (nothing)
add-on-contracts   →  (nothing)
config             →  (nothing)

ui                 →  tokens
charts             →  i18n, tokens
manifest           →  add-on-contracts
widgets            →  charts, i18n, tokens, ui
engine             →  widgets
adapter-postgres   →  engine
adapter-mysql      →  engine
adapter-sqlite     →  engine
schema-import      →  engine
llm                →  engine, widgets

server             →  engine, meta, i18n, llm, schema-import,
                      adapter-postgres, adapter-mysql, adapter-sqlite
dashboard          →  engine, widgets, ui, charts, tokens, i18n
desktop            →  server, adapter-postgres, adapter-mysql, adapter-sqlite
```

Five packages are true leaves with no internal dependencies: `tokens`, `i18n`,
`meta`, `add-on-contracts`, `config`.

The single most counter-intuitive edge is **`engine` → `widgets`**. The engine
is server-side and the widgets package is a React library, so the arrow looks
backwards. It exists because the engine's generator needs the widget *catalog
rules* — which widget accepts which data shape, how a page template's slots are
laid out — and those rules live with the widgets. The edge is confined to two
deliberately pure subpaths, `@adminium/widgets/page-config` and
`@adminium/widgets/generate`; the engine never imports the widgets barrel, so no
React reaches the server.

The layering is written down as twenty forbidden edges in
`.dependency-cruiser.cjs` and checked by `pnpm check-deps` in CI. A related
constraint runs the other way: `@adminium/engine/config` is a **browser-safe**
subpath — no `node:` imports, only `zod` and the pure widgets leaf — which is
what lets the browser, the server and the manifest package validate stored
configuration against literally the same Zod objects.

## 5. Schema to app

This is the pipeline the wizard runs, and the one the Studio re-runs whenever
you ask it to.

### Introspect

Each adapter issues a **fixed** number of catalog statements that does not grow
with your table count — 7 for Postgres, 6 for MySQL, a set of pragma joins for
SQLite — under a total time budget (30 s by default), and assembles the same
normalized `DatabaseModel`.

The dialects genuinely differ in what they can see. Postgres alone reports
multiple schemas, materialized views, comments, row-level security, write
activity, table size, partial and expression indexes, native enums, domains and
array columns. MySQL reports none of those and always marks its row estimates
*approximate*. SQLite has no native enum type at all, so enums are synthesized
by hand-parsing `CHECK (col IN ('a','b'))` out of the stored DDL. Each
degradation is recorded as a typed warning code rather than silently dropped.

**Introspection reads no rows.** Every Postgres statement targets `pg_catalog`,
every MySQL statement targets `information_schema` (a test regex-checks every
`FROM`/`JOIN` target), and every SQLite statement targets `sqlite_master`,
`pragma_*` or `sqlite_stat1`. The one exception is documented and narrow: on
SQLite files under 100 MB with no `ANALYZE` data, a single `UNION ALL` of
`COUNT(*)` supplies exact row counts. It reads no column values. Row counts
everywhere else are catalog estimates — `pg_class.reltuples`,
`information_schema.TABLES.TABLE_ROWS` — never a `COUNT`.

### Classify

Classification is deterministic and rule-based, not statistical, and it never
looks at your data.

**Columns** run through 30 ordered rules, `r01-secret` through `r30-plain`,
first match wins. Every regex runs against a normalized name — `userId` becomes
`user_id`, `HTMLBody` becomes `html_body` — never the raw identifier. Two rules
are pair detectors rather than single-column matches: a start/end date pair
becomes a date range, and a `lat`/`lng` pair becomes a geo point.

PII detection is an independent layer that runs *after* the primary rule and can
fire regardless of which tag won. Nine kinds — email, phone, ip, person-name,
address, dob, gov-id, payment-id, geo-precise — and any hit sets
`maskedByDefault`. The government-ID and payment-ID patterns are anchored on
token boundaries for a reason recorded in the source: unanchored, `vat` matched
inside `avatar_url` ("a-VAT-ar"), and every avatar column in every generated app
was flagged as a government ID and masked.

**Tables** get two outputs: a persisted `role` (one of entity, join-table, log,
people, messages, line-items, system) and a generator-facing `shape` (one of
people, workflow, events, catalog, join, log, settings, geo, generic), each with
human-readable reasons. Precedence is structural first — a join table is
detected before a name pattern is consulted.

### Generate

`generatePages(model, { connectionId, intent })` emits pages in three passes:

1. **Dashboards**, capped at 3. Domains are connected components over the
   relation graph (only edges with confidence ≥ 0.8 count). A domain earns a
   dashboard only if it has a time axis; otherwise it is skipped with a warning.
2. **One CRUD page per included table.** Which columns appear is a fixed
   priority ladder — display column, status, money, timestamps, foreign keys,
   category, person/email, boolean, and so on — capped at 8, with any missing
   primary-key columns appended as hidden specs so row identity still resolves.
   Which editor a field gets is decided the same way, per logical type.
3. **At most one extra archetype page per table** — kanban board, calendar,
   inbox, log viewer, directory and so on — chosen by highest score, and only
   when the template's required slots can actually be filled from that table.

System tables and join tables never get a page, though join tables stay in the
graph so many-to-many relations still connect.

Generation is deterministic by contract: everything is sorted, slugs are
allocated from one registry, and scores are rounded so float association cannot
reorder ties. A baseline test pins the output byte-for-byte.

Four intents shape the result: `full-admin` (the default), `read-only-analytics`,
`crud` and `support-console`. `crud` skips dashboards and archetypes entirely.

Every emitted page is stamped with a `generatedHash` — a canonical-JSON SHA-256
of the envelope with the hash itself excluded — and validated against
`pageEnvelopeSchema` before it leaves the engine. That hash is what makes
regeneration safe: a stored page whose hash no longer matches was edited by a
human, so it is skipped on update and kept rather than pruned on deletion.

## 6. The meta store

Adminium's own database is 34 tables, all prefixed `adminium_`, created by 12
numbered migrations. The same schema runs on PostgreSQL, MySQL/MariaDB and
SQLite.

Portability comes from one module. `columnHelpers(dialect)` maps eight logical
column types onto each dialect's physical types, and the choices are opinionated:
every timestamp is epoch milliseconds in an integer column (never a native
datetime type), JSON is always written as a serialized string, and booleans are
coerced on both read and write. Foreign keys are always named table-level
constraints, because MySQL parses column-level `REFERENCES` and silently discards
them — which would leave a MySQL meta store with no referential integrity at all.

Migrations are **up-only and append-only**. There is no `down`, no revert
command, and no rollback path anywhere in the codebase. Each migration is
recorded in an `adminium_migrations` ledger with a SHA-256 checksum of its own
function source. Before anything is applied, the whole ledger is validated:
editing an already-applied migration aborts with a checksum-drift error, and a
ledger row this build does not recognize aborts with "the database was migrated
by a newer Adminium".

The tables you will care about most:

| Table | Holds |
|---|---|
| `adminium_users`, `_sessions`, `_api_keys` | accounts (argon2id), opaque sessions (only the SHA-256 of the token is stored), API keys (only the hash, plus a display prefix) |
| `adminium_roles`, `_role_permissions`, `_user_roles` | the RBAC matrix |
| `adminium_connections` | one row per source database, **both DSNs encrypted** |
| `adminium_schema_snapshots` | one immutable row per introspection, with a checksum |
| `adminium_schema_overrides` | every correction you make to the generated app |
| `adminium_pages` | every page of the generated app, dashboards included |
| `adminium_views` | saved filters and per-user dashboard layouts |
| `adminium_jobs` | the job queue — table-backed, no Redis |
| `adminium_audit_log` | the append-only audit trail |

There is no `adminium_dashboards` table; a dashboard is an `adminium_pages` row
whose template is `page-dashboard`.

Five columns hold ciphertext, and each is encrypted under a **different** key
derived from `ADMINIUM_SECRET` with a purpose-specific HKDF salt — source DSNs,
the bootstrap file's meta URL, the LLM API key and TOTP secrets can never be
decrypted with one another's key. A wrong secret produces a dedicated,
self-explaining error rather than a bare crypto failure.

Primary keys are type-prefixed monotonic ULIDs — `usr_01J8ME7Q2RZX4V9T6W3YB0KD5N`
— incremented within a millisecond so ids from one process always sort in
creation order. Cursor pagination depends on that.

:::note[Not every table is a shipped feature]
Seven of the 34 tables have DDL and typed models but no repository and no
read/write path yet: `adminium_automations`, `_automation_runs`, `_webhooks`,
`_webhook_deliveries`, `_feature_flags`, `_manifests`, `_changelog_seen`. Four
of the 17 system permission keys are reserved to match. Counting tables will
over-read what the product does today.
:::

## 7. Where your customizations live

This is the part that makes the runtime-interpretation model concrete.

When you rename a column, hide a table, mask a field or add a relation the
database never declared, **the snapshot is not edited**. Snapshots are
immutable. Instead a row is written to `adminium_schema_overrides`, and the
effective model you see is the snapshot with the active overrides layered on
top.

There are exactly eleven override operations:

```
table.label       table.exclude     table.keyField
column.label      column.semanticType   column.enumLabels
column.pii        column.hidden
relation.add      relation.remove   relation.label
```

Each override carries a provenance tier — `user`, `llm` or `auto` — and they
rank in that order. The `auto` tier exists because of a real bug: the
introspector's auto-proposed PII masks were originally stored as `user`, and the
LLM apply step's user-lock then made every machine guess permanently
uncorrectable. (The value is spelled `auto` rather than something longer because
the column is `varchar(6)`.)

The practical consequences:

- **Re-running introspection does not eat your edits.** A new snapshot is a new
  row; your override rows still layer over it.
- **Re-running generation does not eat your page edits either** — that is what
  the `generatedHash` comparison in [§5](#generate) is for.
- Introspection *proposes* masks for you: every column the classifier flagged
  `maskedByDefault` gets a `column.pii` override written at the `auto` tier, so
  PII is masked before you have looked at it, and a later human or LLM
  correction outranks it.

Schema **drift** is detected by re-introspecting and structurally diffing two
snapshots — added and removed tables, per-table column changes, type and
nullability changes, relation changes, plus a `breaking` flag set only when the
change touches something your pages or overrides actually reference. Two caveats
worth stating plainly: column *rename* detection is not implemented (a rename
reads as a drop plus an add), and in this build the diff is an API call you make
yourself — there is no dashboard surface for it.

## 8. One request, end to end

Clicking a row in a generated table is a useful worked example, because it
touches nearly every layer.

```
 1  DataGrid.onRowOpen  →  rowIdOf(columns, row)
      single-column PK → the bare value
      composite PK     → a JSON array of the PK values
 2  router.history.push("/p/<slug>/r/<recordId>")
 3  RecordDetail  →  GET /api/v1/data/<conn>/<table>/<recordId>?include=inboundCounts
─────────────────────────────────────────────────────────────────── server
 4  cookie parsed and unsigned; session token hashed and looked up
 5  manager.mustFind(connectionId)          → 404 if unknown
 6  viewFor(connectionId)                   → latest snapshot + active overrides
 7  view.table("<table>")                   → 422 if not in the snapshot
 8  request.can("table:<conn>:<table>:read") → 403 if denied (audited)
 9  parseRecordId  →  fetchByPk  →  referenceCounts
10  maskRow: secret columns dropped, masked columns nulled + `_masked` marker
11  reply, with x-request-id echoed on the way out
```

The invariant that matters is **step 7 before step 8**. Every identifier that
reaches SQL is a string taken from the stored snapshot, not from the request.
The client's spelling is resolved to a snapshot table first, and the permission
check is then made against that canonical name. Write payloads get the same
treatment: keys are allow-listed one by one and re-spelled from the snapshot
before they reach an `INSERT`. Every value binds as a parameter; every column
reference is `db.dynamic.ref(<snapshot name>)`.

Authorization on the data path lives inside the handler rather than in a route
`preHandler`, precisely because it cannot be decided until the table has been
resolved.

Layered on top:

- **Read-only guards.** A connection marked read-only, or a table with no
  primary key, or a view, rejects any non-read action.
- **PII masking** applies to everyone. `secret` columns are dropped even for
  super admins; `masked` columns are nulled unless the caller holds the unmask
  grant. Audit before/after images are themselves masked.
- **A cursor-leak defence.** Keyset pagination refuses with a 422 when any sort
  key is masked for the caller, because the cursor carries the raw pre-mask sort
  tuple.
- **Snapshot-view caching** keyed on the snapshot id plus the override count and
  the newest override's timestamp — so a new override invalidates immediately.

Dashboards take a different route. A page's widgets each carry a declarative
`binding` — a query *descriptor*, never SQL — and the client extracts them all,
dedupes byte-identical ones, and issues a single `POST /api/v1/widget-data/batch`
(up to 40 descriptors). The server compiles each descriptor under the same
identifier and masking rules, with a hard 1000-row cap and a 30-second cache
keyed by role scope so two users with different grants can never share a cached
result.

### RBAC in one line

Permissions are a string grammar, matched deny-by-default with a `super-admin`
bypass:

```
system:<area>:<verb>              e.g. system:connections:manage
table:<connectionId>:<schema.table>:<action>
page:<pageId>:<view|edit>
```

Granularity is table-level for rows and column-level only for PII masking and
secret hiding. There is no row-level filtering.

Authentication is a signed, httpOnly `adminium_session` cookie carrying an
opaque token whose SHA-256 hash is the only stored form. Passwords are argon2id
at OWASP parameters. TOTP secrets are encrypted; recovery codes are argon2id
hashes. API keys are an alternative principal that acts with exactly one role's
grants.

## 9. From stored config to pixels

The SPA is one build serving every surface. There is no build flag separating
Studio from the Generated App — both are ordinary routes in one code-based
TanStack Router tree, mounted in the same shell. The only difference is a role
check that renders a `forbidden` state instead of the Studio screen.

Boot is deliberately ordered:

1. An inline script in `<head>` — before any stylesheet paints — reads
   localStorage and stamps `data-theme`, `data-accent`, `data-density`, `dir`
   and `lang` on `<html>`. This is why there is no theme flash.
2. `main.tsx` exchanges any desktop boot token, captures a bridge ticket, and
   awaits the i18next instance (capped at 2 s, with an English fallback that
   hot-swaps when the real bundle lands).
3. One `GET /api/v1/bootstrap` primes the session user, roles, resolved theme
   axes and the nav tree, cached with `staleTime: Infinity`.

Generated pages do **not** create N routes. A single dynamic `/p/$slug` route:

```
slug  →  nav tree lookup        (miss → branded 404, no request at all)
      →  GET /api/v1/pages/:pageId
      →  runConfigMigrations    (client-side, on every page load)
      →  pageEnvelopeSchema.safeParse
      →  resolvePageTemplate(envelope.template)   — 14 page templates
      →  the binding component
```

For a dashboard, that binding hands the layout to `PageDashboard`, which turns
each `layout.items[].widget` id into a component through `widgetRegistry.get()`
— a 177-entry map whose `component` fields are `React.lazy` references, so each
widget family is its own chunk and you download only the widgets your pages
actually use.

Every failure mode in that chain renders a card rather than crashing: unknown
slug, config too new for this build, invalid envelope, unknown template, a
throwing template, an unknown widget id. A stored widget config that no longer
matches its schema has the offending fields dropped and re-parsed against
defaults, emitting a console warning — it never throws at render time.

Widgets never navigate or mutate directly. They emit events — `drill-through`,
`record-open`, `mutate` — which the host turns into router pushes or CRUD calls,
then invalidates the right query keys and pushes an undo toast. Server-side
changes arrive over WebSocket and re-enter the same cache, so a regeneration
refreshes the nav and the open page without a reload.

One note on validation asymmetry, because it surprises people: the server does
**not** re-validate a page envelope when it reads one. It validates at the write
boundaries — generation and zip import — and the browser validates on read. Both
use the same Zod objects from `@adminium/engine/config`, which is the whole
point of that subpath being browser-safe.

## 10. One codebase, three ways to run it

| | Process | Meta store | Notes |
|---|---|---|---|
| **npm / self-host** | `adminium start` in a plain Node process | your choice | [Quickstart](/getting-started/quickstart/) |
| **Docker** | the same command as the image's `CMD`, under `dumb-init` as an unprivileged user | SQLite volume or external Postgres/MySQL | [Docker](/getting-started/docker/) |
| **Desktop** | Electron forks the same server as a `utilityProcess` on `127.0.0.1:0` | embedded SQLite, offline | — |

The desktop shell is worth a sentence because the architecture is not what people
expect. Electron does **not** bundle the server or talk to it over IPC. It forks
the same server files, waits for a handshake message carrying the OS-assigned
port, and points a locked-down `BrowserWindow` at `http://127.0.0.1:<port>`. The
renderer is an ordinary browser talking HTTP to a local server. Both native
addons (`better-sqlite3`, `argon2`) are Node-API, so the same binary loads under
Node and under Electron — there is no ABI rebuild step.

### How `@adminium/*` becomes `@adminiumjs/*`

At pack time the release script rewrites every manifest: `@adminium/server`
becomes `@<scope>/adminium`, every other package keeps its basename under the new
scope, and internal `workspace:*` edges become npm aliases —

```json
"@adminium/engine": "npm:@adminiumjs/engine@0.2.1"
```

— so the compiled `import '@adminium/engine'` specifiers keep resolving without
touching a line of source. Packages are then packed, X-rayed, and published in
topological order. Authentication is npm trusted publishing over Actions OIDC;
there is no long-lived token.

All twenty workspaces share one version number, because changesets is configured
with a single `fixed` group. A patch to one package moves all twenty.

## 11. What is deliberately not here

An honest anatomy includes the absences.

- **No code generation.** There is no emitted codebase to own or maintain, and
  `export-zip` gives you the server plus its configuration bundle — never
  something that looks like a generated app.
- **No email *provider* integrations, and no settings screen for SMTP.** This
  bullet used to say the broader thing — that nothing in the repository sends
  mail — and that was wrong end to end. Mail ships: `email.smtp` resolves to a
  real nodemailer transport (lazily imported, so a process that never sends
  never loads it), `email.send` is a registered job kind on `adminium_jobs`, and
  password resets, user invitations, notification emails and the
  template-editor's test send all queue through it. What is genuinely absent is
  the two ends. There is no SES/Postmark/Resend adapter — SMTP or nothing — and
  there is no `/settings/email` page in the dashboard, so the transport is
  configured through `PUT /api/v1/settings/email` or a config-bundle import.
  `smtpConfigured` is a read-only *consequence* of that setting rather than the
  whole of it: it exists so the UI can grey out a Send button instead of
  offering one that would queue nothing.
- **No outbox table.** A queued message is an ordinary `adminium_jobs` row, so
  retry, backoff and dead-lettering come from the queue that already has them.
  The rendered body is sealed with AES-256-GCM under a purpose-scoped key
  because `GET /jobs/:id` can read a payload, and the rendered body of a reset
  mail contains the plaintext single-use token that
  `adminium_password_resets` deliberately stores only as a hash.
- **No PDF or PNG report rendering.** Scheduled reports produce a CSV through
  the export pipeline and an in-app notification; the stored `pdf`/`png` format
  is preserved intent for a later release.
- **No automatic retention sweeps** beyond exports. Garbage-collection methods
  exist for the audit log, jobs, sessions and password resets, but nothing calls
  them on a schedule. Only `retention.exportsDays` is actually read.
- **No row-level security** in the permission model, and no column-level
  permissions beyond PII masking and secret hiding.
- **No rollback** for meta migrations. Forward-only, by design.
- **No statement timeout** on the CRUD query path — session limits are
  configured on the introspection adapters, which the CRUD path does not use.

## Where to go next

- [The packages, one by one](/anatomy/packages/) — the same system taken apart
  package by package.
- [Where to put the meta store](/self-hosting/meta-store/) — the one placement
  decision with a hard rule.
- [CLI reference](/reference/cli/) and [REST API](/reference/rest-api/).
- [Import a schema file](/guides/schema-import/) — the path with no live
  database.
- [LLM assist](/guides/llm-assist/) — how the enrichment round-trip validates a
  model's reply before trusting any of it.
- [Monorepo setup](/contributing/) — if you want to build this from source.

Adminium is AGPL-3.0-only. If you plan to host it for other people, read the
license before you plan anything else.

# Adminium

**From connection string to shipped dashboard.**

Adminium is an open-source engine (AGPL-3.0) that takes a database connection string — or a schema file —
introspects the structure and relations, and generates a complete, professional, themable React admin dashboard.

> **Status: milestones M0–M11 complete** — foundation, design system, engine and adapters,
> generated app, Studio, LLM assist, widget registry (176/176 annex ids), i18n, self-host
> distribution (CLI, Docker, zip export), and the Electron desktop shell. The free v1.0
> release is M0–M11 plus a hardening pass.

## Run it

**A project folder** (Node.js 22.14 or newer) — the way to work on
an admin you want to change and commit:

```sh
npx @adminiumjs/adminium new my-admin --sample
cd my-admin
npm run dev   # → http://localhost:4600
```

`new` writes the folder, a `.env` holding a generated `ADMINIUM_SECRET`, and a
pinned `@adminiumjs/adminium` dependency; `--sample` adds a small demo
database. Without a name, `npx @adminiumjs/adminium new` turns the current
folder into the project. Its pages and schema customizations are files under
`pages/` and `schema/`, which `npm run dev` keeps in step with Studio. Its own
server code goes in `hooks/` and `actions/`, and pages and widgets written in
React in `pages/` and `widgets/`.
[Projects](https://docs.adminium.dev/projects/) ·
[Page files](https://docs.adminium.dev/projects/page-files/) ·
[Hooks and actions](https://docs.adminium.dev/projects/hooks-and-actions/) ·
[Pages and widgets](https://docs.adminium.dev/projects/pages-and-widgets/) ·
[Deploying one](https://docs.adminium.dev/projects/deploy/).

`ADMINIUM_SECRET` is required and must stay **stable** across restarts — it derives
the encryption key for every stored DSN and API key. Generate it once with
`openssl rand -hex 32`.

**Docker Compose** — the reference deployment:

```sh
ADMINIUM_SECRET=$(openssl rand -hex 32) docker compose up
# → http://localhost:4600 → first-run wizard
```

**npm** (Node.js 22.14 or newer):

```sh
npm install -g @adminiumjs/adminium
export ADMINIUM_SECRET=${ADMINIUM_SECRET:-$(openssl rand -hex 32)}  # save this value
adminium start   # → http://localhost:4600
```

On a server, pin the version (`@adminiumjs/adminium@0.3.1`) and set
`ADMINIUM_DATA_DIR`. Do not run a server with plain `npx @adminiumjs/adminium`.
Without a version, npx looks for a newer release on every run. With no
terminal attached, it installs one without asking, and `start` then migrates
the meta store to it. [A VPS without Docker](https://docs.adminium.dev/self-hosting/vps/)
sets up a pinned install under systemd.

Full guides — self-hosting, meta store, LLM assist — at
[docs.adminium.dev](https://docs.adminium.dev).

## Where Adminium runs

Adminium is one long-running Node.js server. It runs on any host that keeps that
process running and gives it a disk that survives restarts. It needs about 165 MB
idle and about 220 MB during a first boot, so **1 GB** suits a VPS where Docker and
a proxy run beside it, and **512 MB** is enough on a managed host that runs the
container for you. A host without a
disk also works, as long as the meta store is a managed Postgres or MySQL
database and files go to a storage bucket.

| Platform | How it runs | Meta store | Files | Setup |
|----------|-------------|------------|-------|-------|
| Any VPS or server, e.g. a DigitalOcean Droplet | Docker Compose, or Node.js under systemd | SQLite on the disk, or Postgres/MySQL | the disk | [`docker-compose.yml`](docker-compose.yml) · [VPS guide](https://docs.adminium.dev/self-hosting/vps/) |
| Railway | the published image, with a volume | SQLite on the volume, or Railway Postgres | the volume, or a bucket | [`deploy/README.md`](deploy/README.md#railway) |
| Render | the published image, with a disk | SQLite on the disk | the disk | [`deploy/render.yaml`](deploy/render.yaml) |
| Fly.io | the published image, with a volume | SQLite on the volume | the volume, or Tigris via `fly storage create` | [`deploy/fly.toml`](deploy/fly.toml) |
| DigitalOcean App Platform | the published image, with no disk | managed Postgres | **a storage destination is required** | [`deploy/do-app.yaml`](deploy/do-app.yaml) |

Docker Compose and the VPS guide have been run end to end. The Railway, Render,
Fly.io and App Platform setups are written against the published image and have
not yet been tried on a live account.

*Files* means uploads, record attachments, export artifacts and the branding
logo. They go to `ADMINIUM_DATA_DIR/files` on the server's own disk unless
`ADMINIUM_STORAGE_URL` sends them to an S3-compatible bucket or a WebDAV server,
which is required on a host with no persistent disk and optional everywhere
else. Installed apps and add-ons are not files, and neither are the automatic
pre-upgrade snapshots of an embedded SQLite store: they always stay in
`ADMINIUM_DATA_DIR`. So on a host with no persistent disk, every installed app,
and every add-on the image does not bundle, is lost at each deploy — see
[`deploy/README.md`](deploy/README.md#apps-and-add-ons-on-a-host-with-no-disk).

### Not supported: Vercel and Netlify

Adminium does not have a serverless mode at the moment, so it does not run on
Vercel or Netlify. Both run code as short-lived functions: Vercel stops an idle
instance after five minutes and keeps no disk, and Netlify functions cannot hold
a live connection open. Adminium needs a process that keeps running for its
background jobs, schedules and live updates. The [example apps](#example-apps)
are static sites, so those do deploy to either.

_Some managed hosts run a revenue-share or affiliate program; Adminium may earn a
commission from them, and the price you pay is unchanged._

## Example apps

Thirteen complete, production-shaped frontends that run on a database Adminium
generated. Each one is a separate public repo, ships with its own `db/schema.sql`
and `db/seed.sql`, a `manifest.json` Adminium reads to scaffold the tables, and a
`docker-compose.yml` that stands up Postgres, the generated dashboard and the app
together. `docker compose up` brings the whole thing up on realistic data with
nothing to configure; `DEMO_DATA=0` starts empty on the same schema instead, and
`npm run demo:wipe` takes the demo rows back out whenever you are ready for your
own — the schema, and anything you added yourself, stay. Every one also runs
offline as a static build with a bundled demo dataset, so the live links below
need no backend.

Browse them at **[adminium.dev/marketplace](https://adminium.dev/marketplace)**.

| App | For | Source | Live demo |
|---|---|---|---|
| Ecommerce Storefront | Commerce | [ecommerce-storefront](https://github.com/Adminiumjs/ecommerce-storefront) | [demo](https://adminium.dev/demo/ecommerce-storefront/) |
| Point of Sale | Retail & restaurant counters | [point-of-sale](https://github.com/Adminiumjs/point-of-sale) | [demo](https://adminium.dev/demo/point-of-sale/) |
| Booking Scheduler | Studios & appointments | [booking-scheduler](https://github.com/Adminiumjs/booking-scheduler) | [demo](https://adminium.dev/demo/booking-scheduler/) |
| Support Desk | Ticketing & SLAs | [support-desk](https://github.com/Adminiumjs/support-desk) | [demo](https://adminium.dev/demo/support-desk/) |
| Learning Platform | Courses & enrolment | [learning-platform](https://github.com/Adminiumjs/learning-platform) | [demo](https://adminium.dev/demo/learning-platform/) |
| Sales CRM | Pipelines & deals | [sales-crm](https://github.com/Adminiumjs/sales-crm) | [demo](https://adminium.dev/demo/sales-crm/) |
| People Ops | HR & onboarding | [people-ops](https://github.com/Adminiumjs/people-ops) | [demo](https://adminium.dev/demo/people-ops/) |
| Client Portal | Agencies & studios | [client-portal](https://github.com/Adminiumjs/client-portal) | [demo](https://adminium.dev/demo/client-portal/) |
| Online Ordering | Restaurants | [online-ordering](https://github.com/Adminiumjs/online-ordering) | [demo](https://adminium.dev/demo/online-ordering/) |
| Event Ticketing | Events & door lists | [event-ticketing](https://github.com/Adminiumjs/event-ticketing) | [demo](https://adminium.dev/demo/event-ticketing/) |
| Clinic Desk | Clinics & health | [clinic-desk](https://github.com/Adminiumjs/clinic-desk) | [demo](https://adminium.dev/demo/clinic-desk/) |
| Factory Ops | Manufacturing | [factory-ops](https://github.com/Adminiumjs/factory-ops) | [demo](https://adminium.dev/demo/factory-ops/) |
| Hotel Reservations | Hotels | [hotel-reservations](https://github.com/Adminiumjs/hotel-reservations) | [demo](https://adminium.dev/demo/hotel-reservations/) |

All thirteen are AGPL-3.0, carry their own `vitest` suites asserting their rules
against the shipped seed, and ship the same
eight locales as Adminium itself — including Arabic, so each one has a full RTL
layout rather than a mirrored afterthought.

They exist to be taken apart. Each reads its data through a one-file `DataSource`
seam (`src/data/source.ts`), so pointing an app at a live Adminium deployment
instead of its bundled seed is a single implementation, with no change to any
screen. The split they all demonstrate is the product argument: **the app is the
daily workflow, and the dashboard Adminium generates from the same schema is the
records, history and reporting behind it.**

## Monorepo

Workspace names below are the in-repo identifiers. On npm the packages publish
under the `@adminiumjs` scope — the `@adminium` scope and the bare `adminium`
name both belong to unrelated parties — so the CLI installs as
`@adminiumjs/adminium` and still provides the `adminium` command.

| Path | Workspace | Purpose |
|---|---|---|
| `apps/server` | `@adminium/server` | Fastify API + serves the dashboard |
| `apps/dashboard` | `@adminium/dashboard` | React SPA: Studio + Generated App |
| `apps/desktop` | `@adminium/desktop` | Electron offline app |
| `apps/docs` | `@adminium/docs` | docs.adminium.dev |
| `apps/e2e` | `@adminium/e2e` | Playwright end-to-end suites (web + desktop) |
| `packages/tokens` | `@adminium/tokens` | Design tokens, palettes, fonts, Tailwind preset |
| `packages/ui` | `@adminium/ui` | Component library (Tiers 1–3) |
| `packages/charts` | `@adminium/charts` | Dependency-light SVG charts |
| `packages/widgets` | `@adminium/widgets` | Widget registry + page templates |
| `packages/engine` | `@adminium/engine` | Introspection, classification, config generation |
| `packages/adapter-*` | — | Postgres / MySQL / SQLite adapters |
| `packages/schema-import` | `@adminium/schema-import` | ORM/DDL schema-file parsers |
| `packages/llm` | `@adminium/llm` | LLM assist (API + BYO round-trip) |
| `packages/meta` | `@adminium/meta` | `adminium_*` meta-store + migrations |
| `packages/i18n` | `@adminium/i18n` | 8 locales, RTL utils, Intl formatters |
| `packages/manifest` | `@adminium/manifest` | Micro-SaaS manifest spec + installer |
| `packages/add-on-contracts` | `@adminium/add-on-contracts` | The typed contracts add-ons fill, and their slot ids |
| `packages/public-client` | `@adminium/public-client` | Browser client for the scoped public API |
| `packages/config` | `@adminium/config` | Shared tsconfig/ESLint (incl. `no-style-prop`)/Prettier |

## Development

Three commands from a fresh clone to a running admin panel:

```sh
corepack enable
pnpm install
pnpm dev
```

The first `pnpm dev` writes a `.env` with a stable `ADMINIUM_SECRET` and builds a sample database to start on, so there is nothing to configure first. Then:

```sh
pnpm lint && pnpm typecheck && pnpm test
pnpm preflight      # every gate CI runs that can run locally, in CI's order
```

The design system's in-repo source of truth is `packages/tokens` + `packages/ui`; browse it through the `@adminium/ui` Storybook.

[CONTRIBUTING.md](CONTRIBUTING.md) has the rest, and the decisions many files rest on are public at [docs.adminium.dev/anatomy/decisions](https://docs.adminium.dev/anatomy/decisions/).

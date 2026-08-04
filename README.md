# Adminium

**From connection string to shipped dashboard.**

Adminium is an open-source engine (AGPL-3.0) that takes a database connection string — or a schema file —
introspects the structure and relations, and generates a complete, professional, themable React admin dashboard.

> **Status: milestones M0–M11 complete** — foundation, design system, engine and adapters,
> generated app, Studio, LLM assist, widget registry (176/176 annex ids), i18n, self-host
> distribution (CLI, Docker, zip export), and the Electron desktop shell. The free v1.0
> release is M0–M11 plus a hardening pass.

## Run it

`ADMINIUM_SECRET` is required and must stay **stable** across restarts — it derives
the encryption key for every stored DSN and API key. Generate it once with
`openssl rand -hex 32`.

**Docker Compose** — the reference deployment:

```sh
ADMINIUM_SECRET=$(openssl rand -hex 32) docker compose up
# → http://localhost:4600 → first-run wizard
```

**npm** (Node 22+):

```sh
npm install -g @adminiumjs/adminium
export ADMINIUM_SECRET=${ADMINIUM_SECRET:-$(openssl rand -hex 32)}  # save this value
adminium start   # → http://localhost:4600
```

Full guides — self-hosting, meta store, LLM assist — at
[docs.adminium.dev](https://docs.adminium.dev).

### Deploy to a managed host

Adminium is a long-running server with a durable meta store, so it runs on any host
that gives it a process plus a disk (or a managed database). Ready-made configs live
in [`deploy/`](deploy/):

| Host | Meta store | Config |
|------|-----------|--------|
| Docker / Compose · any VPS | SQLite volume, or external Postgres/MySQL | [`docker-compose.yml`](docker-compose.yml) |
| Render | SQLite on a disk | [`deploy/render.yaml`](deploy/render.yaml) |
| Fly.io | SQLite on a volume | [`deploy/fly.toml`](deploy/fly.toml) |
| DigitalOcean App Platform | managed Postgres | [`deploy/do-app.yaml`](deploy/do-app.yaml) |
| Railway · Elestio · PikaPods | managed | see [`deploy/README.md`](deploy/README.md) |

**Netlify and Vercel are not supported for the server** — they run
functions/serverless, not a long-lived process with a durable meta store. "Host
anywhere" is delivered by Docker, not by a button that fails on boot.

_Some managed hosts run a revenue-share or affiliate program; Adminium may earn a
commission from them, and the price you pay is unchanged._

## Example apps

Thirteen complete, production-shaped frontends that run on a database Adminium
generated. Each one is a separate public repo, ships with its own `db/schema.sql`,
a `manifest.json` Adminium reads to scaffold the tables, and a `docker-compose.yml`
that stands up Postgres, the generated dashboard and the app together. Every one
runs offline as a static build with a bundled demo dataset, so the live links
below need no backend.

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
| `packages/config` | `@adminium/config` | Shared tsconfig/ESLint (incl. `no-style-prop`)/Prettier |

## Development

```sh
pnpm install
pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

The design system's in-repo source of truth is `packages/tokens` + `packages/ui`; browse it through the `@adminium/ui` Storybook.

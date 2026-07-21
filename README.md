# Adminium

**From connection string to shipped dashboard.**

Adminium is an open-source engine (AGPL-3.0) that takes a database connection string — or a schema file —
introspects the structure and relations, and generates a complete, professional, themable React admin dashboard.

> **Status: milestones M0–M11 complete** — foundation, design system, engine and adapters,
> generated app, Studio, LLM assist, widget registry (176/176 annex ids), i18n, self-host
> distribution (CLI, Docker, zip export), and the Electron desktop shell. The free v1.0
> release is M0–M11 plus a hardening pass. See [workplan/](workplan/README.md) for the full
> execution plan and [workplan/16-milestones.md](workplan/16-milestones.md) for the roadmap.

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

Design comps live in [designs/](designs/) — they are the design system source of truth.

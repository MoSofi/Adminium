# Adminium

**From connection string to shipped dashboard.**

Adminium is an open-source engine (AGPL-3.0) that takes a database connection string — or a schema file —
introspects the structure and relations, and generates a complete, professional, themable React admin dashboard.

> **Status: pre-alpha.** Milestone M0 (foundation) in progress. See [workplan/](workplan/README.md)
> for the full execution plan and [workplan/16-milestones.md](workplan/16-milestones.md) for the roadmap.

## Monorepo

| Path | Package | Purpose |
|---|---|---|
| `apps/server` | `@adminium/server` | Fastify API + serves the dashboard |
| `apps/dashboard` | `@adminium/dashboard` | React SPA: Studio + Generated App |
| `apps/desktop` | `@adminium/desktop` | Electron offline app |
| `apps/docs` | `@adminium/docs` | docs.adminium.dev |
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

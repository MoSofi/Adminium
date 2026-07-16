---
title: Contributing
description: Monorepo setup, the checks CI runs, and the conventions that are enforced rather than suggested.
---

Adminium is AGPL-3.0 and developed in the open at
[github.com/adminium/adminium](https://github.com/adminium/adminium).

## Setup

```bash
git clone https://github.com/adminium/adminium.git
cd adminium
pnpm install
pnpm build
```

Requires **Node 22+** and **pnpm** (pinned via `packageManager` — `corepack
enable` gets you the right version).

```bash
pnpm lint
pnpm typecheck
pnpm test
```

It is a pnpm + Turborepo monorepo: `apps/*` (server, dashboard, docs, desktop)
and `packages/*` (tokens, ui, widgets, charts, i18n, engine, adapters,
schema-import, llm, meta, manifest, config).

## Running it

```bash
export ADMINIUM_SECRET=$(openssl rand -hex 32)
pnpm --filter @adminium/server build
node apps/server/dist/cli/index.js
```

## Conventions that are enforced

These are not style preferences — CI fails on them.

**No `style` props, no raw hex.** Every color, space, and radius comes from
`@adminium/tokens` as a CSS custom property. The `no-style-prop` ESLint rule
enforces it. The one sanctioned exception is assigning a CSS custom property
dynamically.

```tsx
// Fails lint
<div style={{ color: '#4f46e5' }} />

// Fine
<div className="text-accent" />
```

**Logical properties only.** `ms-*` / `me-*` / `ps-*` / `pe-*` / `start-*` /
`end-*`, never `ml-*` / `mr-*`. Adminium ships RTL locales; a physical direction
is a bug in Arabic.

The block-axis utility is `inset-y-*`. `inset-block-*` is **not** a Tailwind
utility — it silently emits no CSS, which is worse than an error.

**Every user-visible string goes through i18n.** No literals in components.

```tsx
t('orders.title', 'Orders')
```

Add the key to `en-US` **and all seven other locale directories** — a parity test
gates it. Dates and numbers go through the `Intl` layer, never hand-formatted.

**Strict TypeScript**, NodeNext ESM, `.js` import specifiers.

**Zod for every external input**, fail-fast.

**The import graph is enforced** by dependency-cruiser. Read
`.dependency-cruiser.cjs` before adding a cross-package import — the layering is
deliberate and circular dependencies are a build failure.

## Adding a database adapter

Adapters implement the `Adapter` interface from `@adminium/engine/adapter` and
declare capability flags. Adapter packages import the engine; the engine never
imports adapters. The server composes them at boot.

## Adding a widget

Widgets are registered `WidgetDefinition`s in `@adminium/widgets`. Definitions
are **metadata-only** — split from component code, so tooling can read the
registry without pulling React.

## Docs

These docs live in `apps/docs` — Astro + Starlight.

```bash
pnpm --filter @adminium/docs dev
pnpm --filter @adminium/docs build
```

The build validates every internal link and every page's frontmatter. A broken
link fails the build.

Every page needs a `title` and a `description`. The `title` is the page's only
H1; body headings start at `##`.

House style: task-first titles (`Connect a PostgreSQL database`, not
`PostgreSQL`), the shortest command that works first, expected output shown, and
**no documenting features that do not exist** — if it has not shipped, the page
says so.

## Pull requests

Branch, make the change, add a test, open a PR. CI runs lint, typecheck, unit
tests, and build. Green before review.

See `CONTRIBUTING.md` in the repository for the full process.

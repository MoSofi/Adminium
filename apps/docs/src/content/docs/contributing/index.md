---
title: Contributing
description: Monorepo setup, the checks CI runs, and the conventions that are enforced rather than suggested.
---

Adminium is AGPL-3.0 and developed in the open at
[github.com/MoSofi/Adminium](https://github.com/MoSofi/Adminium).

## Start in three commands

```bash
git clone https://github.com/MoSofi/Adminium.git
cd Adminium
corepack enable
pnpm install
pnpm dev
```

The admin panel comes up at `http://localhost:5173`. The first `pnpm dev` writes
a `.env` with an `ADMINIUM_SECRET` — generated once and never regenerated,
because it derives the key that encrypts every stored DSN — and builds
`.dev/sample.db` from the desktop app's demo company so the first boot connects
a database and generates pages instead of handing you an empty panel. Create the
first account in the setup wizard; the database is already connected, so skip
step 2.

Requires **Node 22.14 or newer** and **pnpm** (pinned via `packageManager` —
`corepack enable` gets you the right version). There is no separate build step:
`turbo run dev` depends on `^build`.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm preflight     # every gate CI runs that can run here, in CI's order
```

It is a pnpm + Turborepo monorepo of twenty-one workspaces: `apps/*` (server,
dashboard, docs, desktop, e2e) and `packages/*` (tokens, ui, widgets, charts,
i18n, engine, the three adapters, schema-import, llm, meta, manifest,
add-on-contracts, public-client, config).
[The packages, one by one](/anatomy/packages/) is the long version.

## Why it is built this way

The decisions many files rest on are written down, one short page each, under
[Decisions](/anatomy/decisions/). Read the one for the area you are touching
before you change how it works.

Two of them come up in almost every pull request:
[tokens only, no `style` props](/anatomy/decisions/tokens-only/) and
[the i18n rules](/anatomy/decisions/i18n-rules/).

**Comments say what the code does and why, and leave the history to git.** A
comment that needs three paragraphs of backstory is pointing at a decision that
belongs on one of those pages.

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

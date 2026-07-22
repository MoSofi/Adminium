# Contributing to Adminium

Thanks for contributing. This guide covers the day-to-day mechanics; the design and architecture decisions are recorded in the header comments of the modules they govern — read the headers in the area you touch before writing code.

## Prerequisites

- Node.js >= 22 (LTS)
- pnpm 10 (`corepack enable` picks up the version pinned in `package.json`)

## Setup

```sh
git clone https://github.com/MoSofi/Adminium.git
cd Adminium
pnpm install
pnpm build        # turbo run build across the workspace
```

Everyday scripts (all fan out through Turborepo and are cached):

| Command | What it does |
|---|---|
| `pnpm build` | `turbo run build` — compiles every package |
| `pnpm lint` | ESLint (flat config, incl. `adminium/no-style-prop`) + formatting |
| `pnpm typecheck` | `tsc` workspace-wide, strict mode |
| `pnpm test` | Vitest per package |
| `pnpm check-deps` | dependency-cruiser boundary check (`.dependency-cruiser.cjs`) |
| `pnpm changeset` | record a changeset for your change |

## Package map

The allowed import graph is enforced by `.dependency-cruiser.cjs`, where each boundary rule carries its rationale in a comment. Summary:

| Workspace | Purpose |
|---|---|
| `packages/tokens` | CSS custom properties (theme/accent/density/direction), Tailwind v4 preset |
| `packages/ui` | Tier 1–3 React components (Radix + CVA), no data fetching |
| `packages/charts` | Bespoke SVG charts (`d3-scale`/`d3-shape` only) |
| `packages/widgets` | Widget + page-template registry (Tiers 4–5) |
| `packages/engine` | Schema model, classification, config generation + config schemas |
| `packages/adapter-{postgres,mysql,sqlite}` | DB drivers, introspection, CRUD query building |
| `packages/schema-import` | ORM/DDL parsers → `SchemaModel` |
| `packages/llm` | LLM provider clients, prompt builder, response validation |
| `packages/meta` | `adminium_*` migrations + Kysely models |
| `packages/i18n` | 8 locale bundles, ICU messages, RTL utils |
| `packages/manifest` | Manifest schema, validator, installer |
| `packages/config` | Shared tsconfig / ESLint / Prettier (dev-only) |
| `apps/server` | Fastify API + boot sequence, serves the dashboard |
| `apps/dashboard` | React SPA (Studio + Generated App) |
| `apps/desktop` | Electron shell |
| `apps/docs` | Astro Starlight docs site |
| `apps/e2e` | Playwright end-to-end suites (web + desktop) |

Imports between packages are enforced by dependency-cruiser; a violating import fails `pnpm check-deps` (and CI).

## Styling: tokens only, no `style` props

Inline `style` props are banned repo-wide by the custom ESLint rule `adminium/no-style-prop`. All colors, spacing, radii, and shadows come from `@adminium/tokens` CSS custom properties via Tailwind utilities — no raw hex, no off-scale values.

The single escape hatch is an inline object whose keys are **all** string-literal `--adm-*` custom properties on the allowlist, for truly dynamic values (chart geometry, progress %, stagger index):

```tsx
// ❌ rejected by lint
<div style={{ width: pct + "%" }} />

// ✅ allowed: set a CSS variable, consume it from a class
<div
  className="h-1.5 rounded-full bg-accent w-[var(--adm-progress)]"
  style={{ "--adm-progress": pct + "%" }}
/>
```

The full rule specification lives in the rule's header comment: `packages/config/src/eslint-plugin/no-style-prop.js`.

## Adding a package

1. Create `packages/<name>` (or `apps/<name>`) with `"type": "module"` in its `package.json`; use `"catalog:"` versions for `typescript` / `eslint` / `vitest` / `zod`.
2. `tsconfig.json` extends `@adminium/config/tsconfig.base.json`.
3. `eslint.config.js` imports the shared flat config from `@adminium/config/eslint`.
4. Add `build` / `lint` / `typecheck` / `test` scripts so Turborepo picks the package up.
5. Register the package's allowed imports in `.dependency-cruiser.cjs` — the boundary check fails otherwise.
6. Confirm its layer in the dependency graph (the layering comment atop `.dependency-cruiser.cjs`) before adding workspace dependencies.

## Tests

- **Vitest** everywhere for unit/integration tests; Playwright for e2e (from M4).
- Test files live next to the code as `*.test.ts` / `*.spec.ts` (or under `test/` for suites with fixtures).
- Every behavioral change needs a test; bug fixes need a regression test.
- Keep tests deterministic — fake timers/seeds rather than sleeping on real time.
- Run a single package's tests with `pnpm --filter @adminium/<name> test`.

## Changesets & versioning

We use [changesets](https://github.com/changesets/changesets) with **fixed versioning**: all publishable `@adminium/*` packages move on one version train. Every PR that changes published behavior must include a changeset:

```sh
pnpm changeset   # pick bump level, write a user-facing summary
```

Docs-only or CI-only PRs may skip the changeset; say so in the PR description.

## Porting a designed page ("comp")

Never copy comp markup verbatim (comps use inline styles, which are banned). Follow the standing 7-step porting checklist — i18n extraction, token mapping, composition from `@adminium/ui` + registry widgets, known-defect fixes, theme × direction screenshots, and an e2e happy path. A page is "ported" only when all seven steps are green in CI.

## CI & branch protection

`ci.yml` runs on every PR and push to `main`: the `verify` job (lint, typecheck, build, test via Turborepo) and the `dep-graph` job (dependency-cruiser). Both are required checks — see `.github/REPO_SETUP.md` for the branch-protection settings. A nightly workflow re-runs everything with caching disabled.

## Code of conduct

We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Be kind; reports go to conduct@adminium.dev.

## Security

Never open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md).

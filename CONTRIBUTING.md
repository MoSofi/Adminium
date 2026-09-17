# Contributing to Adminium

Thanks for contributing. This guide covers the day-to-day mechanics. The decisions that are load-bearing across the whole codebase are public, one short page each, at [docs.adminium.dev/anatomy/decisions](https://docs.adminium.dev/anatomy/decisions/) — read the one for the area you are touching before you change how it works. Everything narrower than that is in the header comment of the module it governs.

## Start in three commands

```sh
git clone https://github.com/MoSofi/Adminium.git
cd Adminium
corepack enable
pnpm install
pnpm dev
```

The admin panel comes up at **http://localhost:5173** (the dashboard's Vite server, which proxies the API on 4600). The first `pnpm dev` also does the two things that used to be a manual checklist, and says which it did:

- **writes `.env` with an `ADMINIUM_SECRET`.** It derives the key that encrypts every stored DSN and API key, so it is generated once and never regenerated — a value that changed per run would silently make everything already stored undecryptable.
- **builds `.dev/sample.db`** from the desktop app's demo company and points `ADMINIUM_SOURCE_URL` at it, so the first boot connects a database and generates pages instead of handing you an empty panel. Your own `ADMINIUM_SOURCE_URL`, in `.env` or in the shell, is never overridden.

Then create the first account in the setup wizard. The database is already connected, so **skip step 2**.

Requires **Node.js 22.14 or newer** (on Node.js 23, 23.6 or newer). `corepack enable` picks up the pnpm version pinned in `package.json`. `scripts/dev-setup.mjs --print` says what the setup step would do without doing it, and `.env.example` documents every variable including the ones it does not write.

There is no separate build step: `turbo run dev` depends on `^build`, so a fresh clone compiles what it needs first.

Everyday scripts (all fan out through Turborepo and are cached):

| Command | What it does |
|---|---|
| `pnpm build` | `turbo run build` — compiles every package |
| `pnpm lint` | ESLint (flat config, incl. `adminium/no-style-prop`) + formatting |
| `pnpm typecheck` | `tsc` workspace-wide, strict mode |
| `pnpm test` | Vitest per package |
| `pnpm check-deps` | dependency-cruiser boundary check (`.dependency-cruiser.cjs`) |
| `pnpm check-spdx` | every tracked source file opens with `// SPDX-License-Identifier: AGPL-3.0-only`; `--fix` inserts the missing ones |
| `pnpm dev-setup` | the first-run step `pnpm dev` runs for you; `--print` to see it without doing it |
| `pnpm check-private-citations` | no comment points at a document a reader cannot open |
| `pnpm preflight` | every gate CI runs that can run locally, in CI's order (`--quick` for the fast ones) |
| `pnpm changeset` | record a changeset for your change |

New source file? Run `pnpm check-spdx --fix` — it inserts the header (after a
shebang, where there is one). If the gate goes red on a file nobody edited, a
code generator rewrote it: put the SPDX line in that generator's template rather
than exempting the file.

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
| `packages/add-on-contracts` | The typed contracts an add-on fills, and the slot ids it fills them at |
| `packages/public-client` | The browser client for the scoped public API, published for other repos to install |
| `packages/config` | Shared tsconfig / ESLint / Prettier / Vitest policy (dev-only) |
| `apps/server` | Fastify API + boot sequence, serves the dashboard |
| `apps/dashboard` | React SPA (Studio + Generated App) |
| `apps/desktop` | Electron shell |
| `apps/docs` | Astro Starlight docs site |
| `apps/e2e` | Playwright end-to-end suites (web + desktop) |

That is **sixteen packages and five apps, twenty-one workspaces**, and they all move on one
version number — see [one version for every package](https://docs.adminium.dev/anatomy/decisions/one-version/).
Four of them are published; the rest ship inside the flagship tarball
([one npm package](https://docs.adminium.dev/anatomy/decisions/one-npm-package/)).

Imports between packages are enforced by dependency-cruiser; a violating import fails `pnpm check-deps` (and CI).

## Comments, and where the reasoning lives

**Say what the code does and why it does it that way. Leave the history to git.**

The decisions that many files depend on are public, one short page each, under
[/anatomy/decisions/](https://docs.adminium.dev/anatomy/decisions/): pages are settings rather
than generated code, one process with no Redis, the three connections, the add-on trust model,
one version for every package, tokens only, the i18n rules, the LLM never writing on its own,
project code being trusted, and one npm package. A comment that rests on one of those links it
rather than re-explaining it.

A comment that needs three paragraphs of backstory is pointing at a decision that belongs on one
of those pages. And a comment may never cite a document a reader cannot open — the work plan this
repository was built from lives outside it, so a bare document name, section, decision or task id
is a dead end for everyone but the author. `pnpm check-private-citations` holds every file that
has been swept at zero, so new code cannot add one.

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

`ci.yml` runs on every PR and push to `main`: the `verify` job (lint, typecheck, build and test via Turborepo, plus every standalone gate) and the `dep-graph` job (dependency-cruiser). Both are required checks — see `.github/REPO_SETUP.md` for the branch-protection settings. A nightly workflow re-runs everything with caching disabled.

Run `pnpm preflight` before you push: it is the same list in the same order, minus the legs that structurally cannot run on a laptop, and it prints what it did **not** check so a green run is not mistaken for a green CI.

## Code of conduct

We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Be kind; reports go to conduct@adminium.dev.

## Security

Never open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md).

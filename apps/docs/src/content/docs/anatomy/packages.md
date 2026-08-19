---
title: The packages, one by one
description: What each of Adminium's fifteen packages actually contains — its job, its public surface, the decisions inside it, and the rules that keep it in its lane.
---

[How Adminium works](/anatomy/) sketches the package graph in a paragraph. This
page is the long version: one section per package, in dependency order from the
leaves upward, so each one only depends on things you have already read about.

Every package is versioned together — changesets is configured with a single
`fixed` group, so a patch to one moves all twenty workspaces. Source names are
`@adminium/*`; published names are `@adminiumjs/*`.

Sizes below count hand-written source under each package's `src/`, excluding
tests and stories. Tests are counted wherever the package keeps them, which is
not uniform: some put them next to the source, some in a sibling `test/`.

**These are a snapshot, not a contract.** Nothing in CI checks them, so read
them as an order of magnitude and recompute if a number is load-bearing for you:

```bash
# source files (their line count is what the Source column reports)
git ls-tree -r --name-only HEAD -- packages/<pkg>/src \
  | grep -E '\.tsx?$' | grep -v '\.test\.' | grep -v '\.stories\.'

# test files, wherever they live in the package
git ls-tree -r --name-only HEAD -- packages/<pkg> | grep -E '\.test\.(ts|tsx|js)$'
```

Two rows do not fit that shape, and say so in place: `tokens` is mostly CSS, and
`config` is an ESLint plugin written in plain `.js`. Figures below were taken
from `HEAD` on 2026-08-19.

| Package | Source | Tests | Depends on |
|---|--:|--:|---|
| [tokens](#adminiumtokens) | 772 CSS + 145 TS | 3 | — |
| [i18n](#adminiumi18n) | 58 files, 39.2k | 10 | — |
| [meta](#adminiummeta) | 56 files, 10.3k | 22 | — |
| [add-on-contracts](#adminiumadd-on-contracts) | 9 files, 1.1k | 1 | — |
| [config](#adminiumconfig) | 7 JS files, 935 | 6 | — |
| [ui](#adminiumui) | 155 files, 9.6k | 76 | tokens |
| [charts](#adminiumcharts) | 83 files, 9.8k | 15 | i18n, tokens |
| [manifest](#adminiummanifest) | 3 files, 704 | 2 | add-on-contracts |
| [widgets](#adminiumwidgets) | 336 files, 68.1k | 84 | charts, i18n, tokens, ui |
| [engine](#adminiumengine) | 28 files, 5.5k | 17 | widgets |
| [adapter-postgres](#the-three-adapters) | 7 files, 1.8k | 8 | engine |
| [adapter-mysql](#the-three-adapters) | 7 files, 1.9k | 4 | engine |
| [adapter-sqlite](#the-three-adapters) | 8 files, 1.8k | 4 | engine |
| [schema-import](#adminiumschema-import) | 19 files, 5.2k | 11 | engine |
| [llm](#adminiumllm) | 31 files, 7.0k | 23 | engine |

---

## @adminium/tokens

**Every design decision, as a CSS custom property.** Zero dependencies — not
even on other Adminium packages. Mostly CSS: 772 lines across nine files — the
seven axis stylesheets below (687 lines), plus a Tailwind bridge and a barrel —
and 145 lines of TypeScript for the values JavaScript needs.

Seven stylesheets, each owning one axis:

| File | Owns |
|---|---|
| `tokens.css` | the base palette, surfaces, type, radii, shadows |
| `accents.css` | 8 accent palettes |
| `density.css` | the comfortable/compact axis |
| `viz.css` | the chart palette |
| `fonts.css` | `@font-face` and the locale-driven family switch |
| `motion.css` | keyframes and interaction classes |
| `exceptions.css` | the two sanctioned always-dark / always-light scopes |

**Everything accent-derived is computed once**, in CSS, from a single `--accent`
hex via `color-mix(in srgb, …)`: `--accent-soft`, `--accent-hover`,
`--accent-selection`, `--accent-border`, `--accent-glow`. Components never
re-derive them. `--accent-fg` is one inverted foreground per theme, not per
accent, and it is the on-fill colour for *all* solid tones — hardcoding
`text-white` on `bg-pos`/`bg-warn`/`bg-danger` measured 2.00–2.78:1 in dark,
which is why a dedicated ESLint rule now bans that pattern.

The density axis is four properties only: `--row-py`, `--cell-fs`,
`--card-pad`, `--main-pad`. The viz palette is a fixed 8-colour categorical set
(series *i* gets `--viz-((i mod 8)+1)`) plus a 6-step sequential accent ramp.

Motion is 11 keyframes and 9 interaction classes, and the reduced-motion policy
is deliberately **not** uniform: `prefers-reduced-motion: reduce` collapses
animations to 0.01ms, but spinners keep rotating, because a frozen spinner reads
as a hang.

Three font families are self-hosted as unmodified upstream woff2, vendored from
`@fontsource` by a script: **Manrope** for UI text, **JetBrains Mono** for
numerals, code and IDs, **IBM Plex Sans Arabic** scoped to the Arabic unicode
range. CJK is deliberately *not* self-hosted — `zh_CN`/`zh_TW` use system
fallback stacks. Self-hosting is what makes the offline desktop build render as
Adminium with no network font fetch.

`tailwind.css` maps the tokens into a Tailwind v4 `@theme inline` block —
`inline` specifically, so the `var()` references stay live and a runtime theme
flip works without a rebuild. Dark mode is an attribute variant
(`[data-theme="dark"] &`), not a media query.

The TypeScript half is small and exists for two jobs: exporting the axis values
for JS that cannot read CSS, and exporting `preHydrationScript` — a
self-contained string inlined as the first `<script>` in `<head>`. It reads
localStorage, resolves `system` through `matchMedia`, and stamps
`data-theme`/`data-accent`/`data-density`/`dir`/`lang` before any stylesheet
paints. That is the entire flash-prevention mechanism.

:::note[The contrast gate]
`pnpm contrast` is part of this package's `test` script. It parses the real CSS
— no hardcoded palette — replays the cascade for every theme × accent
combination plus each exception scope, resolves `var()` chains, evaluates
`color-mix()` exactly, and computes WCAG 2.1 ratios. It is why token values
carry measured justifications in comments rather than taste: the 12% ceiling on
translucent accent tints is the last strength at which tertiary text on a tint
still clears 4.5:1.
:::

## @adminium/i18n

**Eight locales, ICU messages, and the formatting layer.** A leaf: no internal
dependencies. Its 39.2k lines are mostly generated — 36.9k of that is
`src/resources`, the compiled mirrors.

The eight compiled locales are `en_US`, `de_DE`, `fr_FR`, `cs_CZ`, `da_DK`,
`zh_CN`, `zh_TW`, `ar_EG`. Ids are stored with underscores and converted to
BCP-47 tags by replacing *every* underscore, so a three-subtag id like
`zh_Hant_TW` converts correctly.

**RTL is data-driven, never hardcoded.** `dirForLocale(id)` reads the locale
registry, so an admin-created RTL locale works without a code change. Only
`ar_EG` is `dir: 'rtl'` among the compiled eight. Every lookup helper is total —
none throws on an unknown id — because they run inside a theme subscriber where
a throw means `dir` and `lang` have already flipped.

Five namespaces: `common`, `ui`, `studio`, `generated`, `errors`. The
hand-authored source of truth is 40 JSON files (8 locales × 5 namespaces); a
script regenerates 40 TypeScript mirrors so the runtime can bundle and
chunk-split without JSON import attributes. **en-US ships synchronously** in the
main bundle — it is the fallback text and must never be async — while the other
seven are 35 literal dynamic imports, so a German user downloads only German.

ICU handling is a hand-owned i18next plugin built directly on
`intl-messageformat`'s named export. It replaced `i18next-icu`, whose ESM
default import resolves to the CJS namespace object under Node ESM: the internal
`new` throws, the error is swallowed, and every message silently renders raw.
i18next's own plural-suffix system is disabled — ICU owns plurals.

A parity gate asserts four things across all eight locales: the TS mirror equals
the canonical JSON; every locale carries exactly the en-US key set; every
message parses as ICU with argument *names* matching en-US and plural branches
restricted to the categories that locale actually has; and `zh_CN` and `zh_TW`
are genuinely distinct bundles.

Three entry points keep React off the paths that must not have it:

- `.` — framework-free core
- `./react` — `I18nProvider`, `useT`, `useLocale`, `useRtl`, `useFmt`
- `./server` — a Node instance over the same bundles, for email, report subjects
  and job output

`useMaybeT()` deserves a mention: components that must also render *outside* a
provider — widget chrome in bare tests, Storybook, embeds — use it, and outside
a provider it ICU-formats the English fallback instead of throwing.

The formatting layer has a normative numeral policy driven by a `ctx`
parameter. `ctx: 'data'` forces Latin digits and the Gregorian calendar so
tabular columns stay aligned in every locale including `ar_EG`; `ctx: 'prose'`
uses the locale's own numbering system, so Arabic prose renders Arabic-Indic
digits. Currency codes come from column metadata, never from the viewer's
locale.

## @adminium/meta

**Adminium's own database layer.** A leaf — its only runtime dependencies are
`kysely` and `zod`, and it declares no drivers at all. The caller passes in a
live `pg` Pool, `mysql2` pool or `better-sqlite3` database.

Covered in depth in [How Adminium works §6](/anatomy/#6-the-meta-store). What
belongs here is the package shape:

- **34 tables**, created by **12 up-only migrations**, each checksummed against
  its own function source in an `adminium_migrations` ledger.
- **`columnHelpers(dialect)`** — the whole portability story in one module.
  Eight logical column types mapped onto three dialects. Timestamps are always
  epoch milliseconds in integer columns; JSON is always a serialized string.
- **Repositories** are thin typed closures over the handle — `usersRepo(meta)`,
  `pagesRepo(meta)` — that validate every JSON payload with Zod before it
  reaches the database, and never touch key material. DSN encryption arrives as
  injected `encrypt`/`decrypt` closures, which is why this package can stay
  crypto-agnostic.
- **Type-prefixed monotonic ULIDs** for every primary key, incremented within a
  millisecond so ids from one process always sort in creation order. Cursor
  pagination depends on it.
- **`copyMetaStore`** moves the entire store to a different database in one
  transaction, coercing types from the *target's* introspected columns. It is
  how the Studio relocates a meta store that already exists.

Three details that read as arbitrary until you know the reason: `id` is
`varchar(36)` rather than `char(36)` on Postgres because `bpchar` blank-pads and
breaks round-trips of variable-length prefixed ULIDs; the Kysely instance runs
`CamelCasePlugin` with `maintainNestedObjectKeys` because without it the plugin
also camelCased driver-decoded JSON *values*, turning a stored `{"en_US": …}`
into `{"enUS": …}`; and all foreign keys are named table-level constraints
because MySQL parses column-level `REFERENCES` and silently discards them.

## @adminium/add-on-contracts

**The marketplace extension spec.** A leaf, and the smallest package with real
teeth: 9 files, 1.1k lines.

Two closed registries:

- **11 UI slots** — `artwork.sources`, `checkout.delivery.methods`,
  `order.dispatch.panel`, `order.dispatch.actions`, `settings.add-on.panel`,
  `nav.add-on.routes`, `product.options.personalize`, `cart.line.preview`,
  `product.admin.panel`, `order.line.actions`, `record.editor.panel`. Each
  declares a surface (`customer`/`staff`/`admin`/`both`) and a fill rule. `multi`
  renders every enabled fill in order; `single` takes the lowest order and
  records a conflict warning naming the loser rather than silently overriding.
- **3 provider contracts** — `artwork-source@1`, `shipping-carrier@1`,
  `product-personalizer@1`. A manifest can only claim a contract at a version
  the registry actually carries.

Both are closed for the same reason the widget vocabulary is: an open-ended
extension point cannot be reviewed, translated, or kept working across host
versions.

The interesting part is `./testing`, a separate subpath and the only entry point
allowed to import vitest. It exports conformance suites — `describeArtworkSource`,
`describeShippingCarrier`, `describeProductPersonalizer` — that assert
*behavioural* invariants, not just types: `quote` must be side-effect free, `book`
must be idempotent per order reference, `track` on an unknown reference must
resolve `[]` rather than throw, a refusal must surface as a typed error, `render`
must be deterministic by digest. "The next carrier is a copy of this one" becomes
testable rather than asserted.

The egress allow-list accepts only exact https hostnames, and its regex requires
an alphabetic final label specifically so a literal IP address fails.

## @adminium/config

**The shared toolchain.** Private, publishes no build output, four subpaths:
`./tsconfig.base.json`, `./eslint`, `./eslint-plugin`, `./prettier`. It is a
devDependency of all nineteen other workspaces.

The base tsconfig is strict in the strong sense: `strict`, `isolatedModules`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`,
`NodeNext` resolution, `target: ES2023`.

The ESLint config bans CSS-in-JS imports repo-wide and wires **six in-house
rules**, five of which exist because of a specific past bug:

| Rule | Why it exists |
|---|---|
| `no-style-prop` | Forces every colour, spacing and radius decision through tokens. Allows only inline objects whose keys are all `--`-prefixed CSS custom properties. No autofix. |
| `no-literal-color-on-token-bg` | `bg-accent text-white` pinned half a token pair and dropped contrast from 6.29:1 to 2.29:1 in five components when the dark accent was retuned — invisible to the token-vs-token contrast script. |
| `no-literal-strings` | 49 hardcoded strings rendered English in all 8 locales on the 404/500/offline pages. Scoped to dashboard, widgets and desktop — `@adminium/ui` is deliberately exempt, because by contract every string there arrives as a prop. |
| `no-physical-direction-classes` | Bans `ml`/`mr`/`pl`/`pr`, `left`/`right`, `border-l`/`border-r`, `text-left`/`text-right`. Matches after stripping variant prefixes, so `rtl:ml-2` is caught too. |
| `no-t-result-replace` | `t(k).replace('{count}', …)` only works via a thrown-and-swallowed ICU error. |
| `no-dynamic-i18n-key` | A computed translation key cannot be extracted, reviewed or translated. |

## @adminium/ui

**The component library.** 66 component directories, 155 source files, backed by
76 test files and 71 Storybook stories. Its only internal dependency is tokens.

Components are organised into tiers, visible in Storybook titles. The tier is a
component's **scope**, not its complexity:

| Tier | Count | What it means |
|---|--:|---|
| Tier 1 · Primitives | 19 | Presentational only — Avatar, Badge, Button, Icon, Spinner, StatusPill, Tag… |
| Tier 2 · Form controls | 18 | Input, Select, Combobox, DateInput, SecretInput, Switch, Slider… |
| Tier 3 · Composites | 25 | Own state or portals — Modal, Drawer, CommandPalette, Toast, Tabs, Popover… |
| Tier 4 · Matrices | 2 | PermissionMatrix, ToggleMatrix |
| Tier 5 · Auth screens | 2 | AuthLayout, AuthScreens |

There is no `tier` field on any TypeScript type — the tiers are a Storybook
organising convention.

Eleven Radix primitives are used, `react-slot` most heavily. Fourteen of the 66
directories use `cva()`; the rest are plain class composition.

Two things carry more weight than their size suggests:

**`cn()`** is `twMerge(clsx(...))` where tailwind-merge has been *extended* with
the token font sizes, the 30 token colours and the four shadow names. Without
that, `text-micro` (type scale) and `text-fg-subtle` (colour) both land in
tailwind-merge's ambiguous `text-*` group and one silently wins.

**`ThemeProvider`** resolves each axis in a fixed order — baseline defaults ←
localStorage cache ← global defaults ← user prefs ← in-session override — then
stamps the DOM attributes in a `useLayoutEffect`, writes the cache back, and
notifies subscribers, in that order. localStorage is a *pre-paint cache*, never
a preference source. It also wraps children in Radix's `DirectionProvider` so
every primitive gets RTL keyboard and positioning behaviour from the same source
of truth as `<html dir>`.

The root barrel `src/index.ts` is **generated** on every build by a script that
collects each component's local index. Component authors add a local `index.ts`
and never touch the root.

Icons are Lucide exclusively, wrapped by an `Icon` component with a closed size
scale and an `rtlMirror` prop for directional glyphs.

:::note[The a11y ratchet]
`pnpm a11y` runs axe over every built Storybook story in **both** themes with
reduced motion, failing on any critical or serious violation. It is a
fingerprint ratchet against `packages/ui/a11y-baseline.json`, keyed
`story|theme|rule`: a fingerprint already in the file is a known exception, and
only a fingerprint the file has never seen fails the gate. The run's log prints
*every* blocking violation it finds, baselined or not, so a red job and a long
log are not the same thing — diff the fingerprints before concluding anything.

This page used to quote the baseline's size. It no longer does, and that is the
point of this paragraph: the number is a debt counter, not a fact about the
product. It moves every time someone fixes a violation or records one, no CI
check holds it to any figure, and the number printed here had drifted well past
the file's actual contents before anyone noticed. Open
`packages/ui/a11y-baseline.json` for the current entries — its own header
documents how they are added and removed.
:::

## @adminium/charts

**SVG chart primitives.** 83 source files, 9.8k lines, and **no charting
library of any kind**.

"d3 math only" is literal. The package imports exactly two things from d3:
`scaleBand`, `scaleLinear`, `scalePoint`, `scaleTime` from `d3-scale`, and
`arc`, `pie`, `area`, `line` plus three curve functions from `d3-shape`.
Everything else — treemap, sunburst, sankey, chord, hexbin, wordcloud, violin,
cohort matrix, choropleth tilegram — is hand-written geometry across 40 modules
in `src/geometry/`. The package even avoids `d3-array`: `bins`, `extent`,
`niceTicks`, `quantileSorted` and `tickStep` are reimplemented in about 60 lines
so charts never pull it.

37 chart components render through one shared viewport, **`ChartSurface`**:
ResizeObserver-measured width, a padding model, a direction context, a mount
animation gate, `role="img"` with a required label, an optional `<desc>`, a
visually-hidden slot for the data-table equivalent, and a `data-export-node`
marker for raster export. Children are a render function receiving
`{ width, height, innerWidth, innerHeight, rtl, mounted }`.

The geometry modules are exported separately as pure, DOM-free functions —
explicitly server-safe, for rendering charts into scheduled reports.

Charts never write hex literals. Colours and keyframes come from tokens; the
package's own stylesheet only wires them to chart elements, using logical CSS
properties only.

**The RTL policy lives in the scale constructors, not the components.** The
categorical band and point scales flip their range when `rtl` is true; the time
scale **never** mirrors — oldest left, newest right, even inside an RTL page.
Charts default to `'ltr'` and never read the app's direction themselves; the
widgets package bridges it in.

## @adminium/manifest

**The micro-SaaS manifest spec.** Three files, 704 lines, one internal
dependency (add-on-contracts).

A manifest is a `manifestVersion: 1` document validated by a Zod discriminated
union on `kind`. A document with no `kind` is preprocessed to `'app'`, which
keeps every manifest written before add-ons existed valid without moving the
frozen version.

An **app** manifest carries identity (a kebab `key`, strict-semver `version`,
publisher, SPDX license, i18n description, at least one category), a
compatibility range, a `requiredSchema` of typed tables, at least one page, and
a frontend block. An **add-on** manifest omits `pages`, `roles` and `frontend`
from the schema *entirely* — the reasoning being that leaving the fields off is
a stronger guarantee than a lint rule. Both branches are `.strict()`.

`validateManifest` layers policy on top of the schema and never throws: it
rejects any publisher other than first-party unless explicitly allowed (off in
v1), rejects reserved keys, and appends add-on issues such as
`SLOT_UNKNOWN`, `NETWORK_ALLOW_REQUIRED` and `FRONTEND_SECRET_LEAK`.
`parseManifest` is the throwing variant, for build tooling.

## @adminium/widgets

**The biggest package in the repo** — 336 source files, 68.1k lines, 84 test
files. It owns the widget registry, the page templates and the dashboard grid.

### The registry

A widget is registered by calling `defineWidget({...})` inside a per-family
definitions module; `registry/index.ts` spreads 22 such arrays into a builder
that throws on any duplicate id at module init. The registry currently holds
**177 widget ids across 13 families**:

| Family | Count | What lives there |
|---|--:|---|
| `domain` | 43 | Document blocks — line items, tax breakdowns, pay QR codes |
| `charts` | 37 | One per chart component in `@adminium/charts` |
| `forms` | 20 | Field editors and form chrome |
| `tables` | 17 | Grids, galleries, log tables, trees |
| `kpi` | 10 | Stat cards, gauges, period comparisons |
| `system` | 10 | Nine system widgets plus the `widget-missing` fallback |
| `chrome` | 8 | Page furniture |
| `calendar` | 8 | Month, week, agenda, scheduler views |
| `feeds` | 7 | Activity streams and timelines |
| `media` | 6 | Images, files, previews |
| `communication` | 5 | Threads and message panes |
| `boards` | 4 | Kanban and swimlanes |
| `geo` | 2 | Map and grid choropleth |

A `WidgetDefinition` declares an id, a family, a `component` (always a
`React.lazy` ref), a Zod `configSchema` that is always an `.extend()` of one
shared schema, a `dataContract` naming one or more of 18 canonical data shapes,
grid `sizing`, `placement`, a `skeleton` silhouette, optional `capabilities`, a
deterministic `demoData(seed)` generator, and an i18n `descriptionKey`.

Visual variants are **config, never new registry ids** — `gauge-arc` declares
two data contracts and switches between speedometer and cluster mode from
config.

The id set is also mirrored as a checked-in pure list with a parity test that
fails on drift in either direction. That inversion exists because the generator
leaf and the engine may not import component code, but still need to know which
widget ids are real.

### Data shapes and bindings

There are 18 canonical data shapes, of which **only six are currently
compilable** — `single-metric`, `metric+delta`, `timeseries`, `categorical`,
`record-list`, `stream`. That subset is a single source of truth shared by the
server's query compiler and the LLM allow-list; the two had drifted, which is
how the enrichment prompt came to offer 17 widgets no binding could ever
satisfy.

A widget is bound to data by a **declarative query descriptor, never a SQL
string**: a source table, a shape, select columns, up to 8 aggregations, up to 2
group-bys, a time bucket, up to 16 filters over 13 operators, a window, ordering,
a limit capped at 1000, and a cursor.

### Rendering

`WidgetHost` is the binder. In order: resolve the offline id (`map-*` becomes a
grid choropleth on desktop, so Leaflet is never imported), look up the
definition, fall back to `widget-missing` on an unknown id, validate the stored
config, derive one of four frame states, resolve the description key, and mount
the lazy component inside a `<Suspense>` whose fallback is the same skeleton
silhouette.

**Config validation never throws at render time.** A stored config that fails
its schema has each offending top-level field dropped and is re-parsed, falling
back to schema defaults if that also fails, returning structured warnings that
surface as a single console line.

Widgets never navigate or mutate. They emit one of three events —
`drill-through`, `record-open`, `mutate` — which the host interprets.

The grid is 12 fluid columns with heights in half-row units of 40px, capped at
60 items, with deterministic top-gravity compaction and reading-order stacking
below `lg`.

### Four entry points

`.` is the full React surface. `./page-config` is a pure-Zod leaf importing only
zod. `./generate` is the pure generator leaf. `./binding` is the realtime stream
layer. The two leaves exist so the engine and the server can consume them
without pulling React, and both are gated by purity tests as well as by
dependency-cruiser.

There is also a **second registry**: 14 page templates — `page-crud`,
`page-dashboard`, `page-board`, `page-calendar`, `page-scheduler`,
`page-directory`, `page-master-detail`, `page-queue-inbox`, `page-log-viewer`,
`page-files`, `page-chat`, `page-builder`, `page-wizard`, `page-settings` — each
with a `recommendable` flag. Four are renderable but not LLM-recommendable.

The LLM allow-lists are **derived** from the live registries plus the compilable
shape set, never hand-maintained, so a widget the runtime cannot feed can never
be suggested.

## @adminium/engine

**The brain**, and it holds no database drivers. 28 files, 5.5k lines — small
for what it does, because it is pure logic over one IR.

Covered end to end in [How Adminium works §5](/anatomy/#5-schema-to-app). The
package surface:

- **`DatabaseModel`** (aliased `SchemaModel`) — the normalized IR, a Zod schema
  with a `superRefine` cross-reference integrity check that runs on every parse.
  Duplicate ids, primary keys or FK mirrors pointing at unknown columns, relation
  endpoints pointing at unknown tables, an `enumRef` naming an unknown enum — all
  fail parsing. A snapshot can never persist a dangling reference, so nothing
  downstream has to defend against one.
- **`DatabaseAdapter<Role>`** — the contract a dialect implements. Eleven
  capability flags, and role separation enforced by `this` typing.
- **Classification** — 30 ordered column rules, nine PII kinds, 7 table roles and
  9 table shapes.
- **Snapshotting** — `hashModel` strips volatile fields (timestamps, row
  estimates, sizes), sorts every collection, deep-sorts every object's keys, then
  hashes. Two introspections that enumerate the catalog in a different order hash
  identically, which is what makes the meta store's "same checksum, no new row"
  dedupe work. `diffModels` produces the structural diff.
- **Generation** — `generatePages(model, opts)` returning validated envelopes.

Three exports, and the split matters:

| Subpath | Contains |
|---|---|
| `.` | the full engine |
| `./config` | the browser-safe config leaf |
| `./adapter` | the interface adapters import |

`./config`'s browser-safety is enforced twice — by a test that reads every file
under `src/config-schema/` and asserts no `node:` import and no bare specifier
other than zod and the pure widgets leaf, and by dependency-cruiser rules. What
it buys is one validation authority: the browser, the server and the manifest
package all parse stored config with literally the same Zod objects, so a config
that renders is a config the server would accept.

One deliberate oddity: **SHA-256 is implemented from scratch** rather than
imported from `node:crypto`, so the engine's subpaths stay environment-agnostic
and bundlable client-side. Web Crypto's `subtle.digest` was rejected because it
would have made the pure snapshot API async.

The config **migration** mechanism is a version-step chain keyed solely on the
envelope's `v`. `CONFIG_VERSION` is 1 and the migration list is currently empty;
the runner refuses a document that is newer than this build with "upgrade
Adminium to open it", and hands each step a `structuredClone` so a mutating
migration cannot corrupt the caller's document.

## The three adapters

`adapter-postgres`, `adapter-mysql`, `adapter-sqlite` — around 1.8k lines each,
identically shaped. Each declares exactly one internal dependency
(`@adminium/engine`) and imports only `@adminium/engine/adapter`.

Each provides two things: a **`DatabaseAdapter`** for introspection and
capability probing, and a **`createQueryEngine()`** returning the Kysely dialect
the CRUD layer runs on. Adapters register themselves into a process-wide
registry at boot; registering the same dialect twice throws.

What differs is what each dialect can see:

| | Postgres | MySQL / MariaDB | SQLite |
|---|---|---|---|
| Catalog | `pg_catalog` (7 statements) | `information_schema` (6) | `sqlite_master` + `pragma_*` |
| Schemas | multiple | connected DB only | n/a |
| Enums | native types | parsed from `COLUMN_TYPE` | synthesized from `CHECK` |
| Comments | tables + columns | — | — |
| Row counts | `reltuples` estimate | `TABLE_ROWS` (approximate) | exact, files < 100 MB |
| Materialized views | ✓ | — | — |
| RLS | ✓ | — | — |
| Write activity | `pg_stat_user_tables` | — | — |
| `RETURNING` | ✓ | MariaDB ≥ 10.5 only | ✓ |
| Max identifier | 63 | 64 | 128 |

The canonical capability values live in **one matrix in the engine**, not in the
adapters — each adapter re-exports its own slice. That is why the setup wizard's
honesty copy and the adapter can never disagree about what a dialect can express.

Each dialect earns its own hard-won details. Postgres sets session limits through
the startup packet and falls back, once, on "unsupported startup parameter", to
rebuilding the pool with a `SET LOCAL` prelude — the path that makes pooled
Neon/pgbouncer connections work at all. MySQL refuses servers below 8.0 (or
MariaDB 10.5), maps `tinyint(1)` to boolean, and upgrades a `char(36)` named
`uuid` by name alone. SQLite applies its five-rule affinity algorithm first, then
declared-name hints — and skips the hints entirely for `STRICT` tables.

The row-touching methods on the interface (`count`, `sample`, `query`, `mutate`)
are deliberately unimplemented in all three and throw `UNSUPPORTED`. Production
CRUD goes through `createQueryEngine()` instead.

## @adminium/schema-import

**Eight schema-file parsers, one IR.** 19 files, 5.2k lines. This is what lets you
generate a dashboard with no live database connection at all.

One entry point, `parseSchemaFile(content, opts)`, over eight formats: `sql`
(including pg_dump and mysqldump), `prisma`, `drizzle`, `typeorm`, `sequelize`,
`rails`, `django`, and the engine's own `json` IR. Format auto-detection is an
ordered regex probe list; when more than one fires, the first wins and an
`ambiguous-format` warning is recorded.

**Every parser is hand-rolled at the tokenizer level** — no ecosystem compiler,
no runtime. SQL is a statement splitter plus cursor mini-parsers that understand
pg_dump's `ALTER TABLE ONLY … ADD CONSTRAINT` form. Prisma is a block parser.
Drizzle locates the table builders by regex and walks the column chains. TypeORM
reads decorators, falling back to a `<prop>_id` convention with a warning.
Sequelize handles both `sequelize.define` and `class extends Model`. Rails and
Django are line grammars.

All of them feed a shared `ModelBuilder` whose `finalize()` drops duplicate and
column-less tables, reconciles primary keys, resolves or drops dangling FK
targets with a warning, synthesizes relations from column-level references, and
finally runs the model through the engine's own parser — so the output is always
schema-valid and referentially consistent.

Parsers **never throw on an unsupported construct** inside an otherwise-parseable
file; they record a warning, with high-volume skips aggregated into one counted
entry. A hard error is reserved for wholly unusable input.

The SQL parser strips pg_dump's `COPY … FROM stdin;` row payloads before
tokenizing. You can drop a full production dump in and only its structure is
read.

The same function also backs the desktop's local-database feature, turning an
uploaded schema file into a real SQLite database. Its DDL emitter deliberately
writes `VARCHAR(n)` and `CHECK (col IN (…))` rather than plain `TEXT`, because a
`TEXT` status column introspects back with no max length, fails the kanban
candidate rule's length gate, and silently downgrades a board to a CRUD grid on
the round trip.

## @adminium/llm

**LLM assist as a headless library.** 31 files, 7k lines, 23 test files — the
most heavily tested package relative to its size, because it treats model output
as untrusted input.

Five provider ids are declared; **four are implemented** — `anthropic`,
`openai`, `openai-compatible`, `ollama`. All four are plain `fetch` calls with no
vendor SDKs. Enrichment runs are pinned to `temperature: 0`, asserted at the top
of every client's `complete()`, so two runs of the same prompt diff identically.

The API key is scrubbed from every error surface, including the `cause` chain
that loggers walk — a provider echoing an `Authorization` header back in an error
body is the normal leak path.

### One prompt builder, two front doors

`buildPrompt` is the single producer of prompt text, and `flattenByo` joins its
two sections with `=== SYSTEM ===` / `=== USER ===` markers. **The bytes you
paste into a chat window are identical to what the direct API path sends.** That
is what makes "paste this into any LLM" produce a reply the same validator
accepts.

**The prompt is sample-free by default.** The serializer emits structure only —
names, types, nullability, key flags, declared enum values, FK targets, PII
flags — and deliberately copies only row-count, null-fraction and distinct-count
statistics, never min/max/sample values, *even when the adapter collected them*.
Cell values appear only in an opt-in sampling block that skips every
PII-suspected or secret column. The guarantee is enforced at the serializer, not
left to the caller.

Oversized schemas are chunked by clustering tables over the FK graph, with
`"stub": true` entries for out-of-chunk FK targets so every chunk validates on
its own, and an order-independent deterministic merge.

### The seven-stage validator

`validateResponse` never throws. It runs: brace-walk extraction (reporting
truncation when a brace never closes), JSON parse, version negotiation, Zod
schema parse, locale-key exactness, referential cross-checks, and run-id binding.
Twenty validation codes, of which five are fatal and three are warnings;
everything else drops one suggestion and lets the rest through.

Stage six is the one that matters. It proves the response is *true*, not merely
well-shaped — rejecting unknown tables and columns, a display column that is the
surrogate primary key, an enum order that is not a permutation of the declared
values, a confirmed relation with no matching declared FK, templates or widgets
outside the injected allow-lists, numeric aggregations on non-numeric columns,
non-temporal time columns, and a table claimed by two nav groups.

Dropping a table **cascades**: its enum suggestions and every dashboard widget
bound to it go with it.

Accepted suggestions carry deterministic ids so accept/reject state survives a
reload and re-application is idempotent. The diff has six statuses, and bulk
accept selects only `conflict` and `llm-new` above the threshold — so an LLM
rejection of a heuristic flag, and anything already carrying a user override, can
never be swept in automatically.

Two contract versions are frozen and pinned by snapshot test, so editing the
prompt forces a deliberate version bump.

---

## The layering law

The dependency rules are declared as twenty forbidden edges in
`.dependency-cruiser.cjs` and checked by `pnpm check-deps` in CI:

```
no-circular                      tokens-imports-nothing
i18n-no-ui-server                charts-only-tokens
docs-only-tokens                 ui-no-charts-widgets-engine
widgets-no-full-engine           widgets-no-meta-adapters-server
engine-no-meta-adapters          engine-no-full-widgets
adapters-only-engine-adapter     meta-no-engine-adapters-server
manifest-no-server-ui            schema-import-no-adapters-server
llm-no-server-ui                 server-no-ui-widgets-charts
dashboard-no-full-engine         dashboard-no-meta-adapters-llm
dashboard-desktop-api-leaf-only  desktop-shell-only
```

Each rule matches three spellings of the same dependency at once — the resolved
workspace path, the pnpm symlink, and the raw specifier — so an unbuilt package
cannot slip an edge past the check.

Four sanctioned subpath leaves are carved out by exception:
`@adminium/engine/config`, `@adminium/engine/adapter`,
`@adminium/widgets/page-config` and `@adminium/widgets/generate`. Those four
exceptions are what let the graph stay acyclic while the engine still drives the
widget registry.

## Where to go next

- [How Adminium works](/anatomy/) — the runtime view: boot, request lifecycle,
  and where customizations live.
- [Monorepo setup](/contributing/) — building all of this from source.
- [Manifest spec](/reference/manifest/) — the full schema reference.

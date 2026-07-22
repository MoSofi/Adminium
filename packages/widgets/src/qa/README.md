# Widget QA harness (04-T17)

The permanent gate every Wave-1 widget passes. Lives in `packages/widgets/src/qa`;
runs under the package's vitest project (`pnpm --filter @adminium/widgets test`).

## What it checks

| File | Acceptance | Gate |
| --- | --- | --- |
| `registry-parity.test.ts` | #1 | Delivered registry ids diff against the checked-in annex extraction; fails on drift, duplicate ids, or Wave-1 coverage gaps outside the documented pending set. |
| `determinism.test.ts` | #11 | `demoData(seed)` is byte-identical across runs (stable-stringify) and independent of call order, for every widget. |
| `frame-states.test.tsx` | #4 | Every widget renders all four WidgetFrame states through `WidgetHost`: skeleton silhouette, per-widget empty copy, error + a Retry that re-issues the query, and a non-crashing loaded body. |
| `config-fuzz.test.tsx` | #4/#17 | N deterministic, schema-valid configs per widget (sampled via `zod-sample.ts`) render without tripping the error boundary. |
| `chunk-budget.test.ts` | #3/#8 | charts depends on d3 only; widgets declares no heavy Wave-2/3 map/board deps; no Wave-1 family source imports them; every component is a `React.lazy` ref (one chunk/family); the default page-dashboard pulls only Wave-1 families. |
| `qa-widgets.stories.tsx` | #4/#9 | Storybook story per family rendering every widget × four states, tagged `vrt` for the light/dark × LTR/RTL screenshot matrix, with a per-story axe (addon-a11y) pass. |

Source of truth: `annex-catalog.ts` (verbatim ids from the internal
widget-registry annex, §1–§13). Harness coverage set:
`delivered.ts` (aggregates the per-track definition arrays directly, so it
exercises every delivered widget regardless of GREEN-LOOP registry wiring).

## Known-pending (ratchets, not failures)

Two out-of-scope dependencies are handled as **ratchets** — the gate is written
correctly and auto-activates as each dependency lands, staying green until then
and logging exactly what is outstanding:

1. **GREEN-LOOP registry wiring.** `registry/index.ts` currently imports only the
   M4 slice; the 37 Track-F / 04-T09 widgets exist as per-track definition
   modules but are not yet spread into the live `widgetRegistry`.
   `registry-parity.test.ts` gates the assembled-equivalent (`qaRegistry`) now and
   skips the live-`widgetRegistry` assertion with a warning until the loop wires
   them.

2. **`@adminium/charts` barrel assembly.** 17-18 chart widgets import primitives
   (`Sunburst`, `Funnel`, `Sankey`, `CohortMatrixChart`, …) that the built
   `@adminium/charts` `dist` barrel does not yet export. Until the GREEN LOOP
   assembles `packages/charts/src/index.ts` **and rebuilds charts**, their loaded
   body can't render; `frame-states`/`config-fuzz` classify this as
   `barrel-pending` and skip the loaded assertion (skeleton/empty/error still
   gate), logging the list.

### Activating the VRT + Storybook wiring

`qa-widgets.stories.tsx` is VRT-ready (tagged `vrt`, matrix profiles + axe in
`parameters`). The workspace Storybook glob in
`packages/ui/.storybook/main.ts` has the widgets/charts globs **commented out**
because, pre-barrel-assembly, some widget stories import chart primitives the
built barrel doesn't export and the Storybook build fails to resolve them. Once
the barrel is assembled + charts rebuilt:

1. uncomment the two glob lines in `packages/ui/.storybook/main.ts`;
2. `pnpm --filter @adminium/ui build-storybook` to confirm it resolves;
3. capture baselines inside the CI Linux container: `pnpm --filter @adminium/ui vrt:update`
   (macOS/Windows re-captures produce font-rasterization diffs that must not be
   committed — see `packages/ui/playwright.config.ts`).

## Findings surfaced (fixed / flagged)

- **Fixed** (`lib/format.ts` + `@adminium/i18n` + `formatMoney`): an empty /
  whitespace `format.locale` or `format.currency` (both schema-valid free
  strings) made `Intl` throw "Incorrect locale information provided", crashing
  every widget that formats. `formatOptionsOf` normalizes to `undefined`;
  `@adminium/i18n` `getFormatters` now coalesces an empty/invalid BCP-47 tag to
  `en-US` (the universal fix, covering widgets like `unread-badge` that call it
  directly); and `formatMoney` coalesces an empty currency to `USD`. The fuzz
  pools now **include** `''` for `locale`/`currency`, so the suite genuinely
  covers this valid-config path instead of excluding it.
- **Flagged** (non-crash): `mini-table` emits duplicate React keys under some
  fuzzed configs (console warning only). Low priority; owned by the tables family.

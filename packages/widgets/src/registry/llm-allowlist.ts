/**
 * LLM allow-lists (06-llm-assist.md §4.4/§5) — the closed vocabularies the
 * schema-enrichment prompt injects so the model can only ever suggest page
 * templates, dashboard widgets and status tones the runtime can actually render.
 *
 * All three lists are DERIVED from the live registries in this package
 * (`pageTemplateRegistry`, `widgetRegistry`) plus the shared widget-config tone
 * enum — never a hand-maintained parallel list. When M7 registers new templates
 * or widgets they enter the registry and these lists grow automatically, while
 * `llm-allowlist.test.ts` guards the invariant that nothing un-renderable can
 * appear (an allow-listed id that no longer resolves fails the build).
 *
 * Pure constants + registry reads — no component code runs at import time, so
 * the enrichment prompt builder can consume these without pulling the render
 * layer's chunks.
 */

import { widgetRegistry } from './index.js';
import { pageTemplateDefinitions } from './page-templates.js';
import type { WidgetDefinition, WidgetFamily } from './types.js';
import { isCompilableShape } from '../page-config/index.js';
import type { DataShape } from '../page-config/index.js';

/* ------------------------------------------------------------------ helpers */

function sortedUnique(ids: Iterable<string>): readonly string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b, 'en'));
}

function dataContractIncludes(contract: DataShape | DataShape[], shape: DataShape): boolean {
  return Array.isArray(contract) ? contract.includes(shape) : contract === shape;
}

/** A widget's declared contract as a list, whether it declared one shape or several. */
function contractShapes(contract: DataShape | DataShape[]): readonly DataShape[] {
  return Array.isArray(contract) ? contract : [contract];
}

/**
 * Can the widget-data pipeline actually FEED this widget? A dashboard tile is
 * only useful if some query descriptor produces a payload its data contract
 * accepts, and the compiler implements six of the eighteen canonical shapes
 * (04 §5.2 "M4 scope notes").
 *
 * Without this test the prompt offered 17 widgets — `chart-sankey` (`flows`),
 * `chart-multiline` (`multi-timeseries`), the five `matrix` charts, the three
 * `distribution` ones, and so on — that no binding could ever satisfy: every
 * one of them was guaranteed to render "Unexpected data shape" or reject with
 * 422 the moment a model chose it. They rejoin automatically when 04-T09/T10
 * teaches the compiler their shapes, because both sides read
 * `COMPILABLE_DATA_SHAPES`.
 */
function isBindable(definition: WidgetDefinition): boolean {
  return contractShapes(definition.dataContract).some(isCompilableShape);
}

/* ---------------------------------------------------------- page templates */

/**
 * The RECOMMENDABLE page-template vocabulary, injected as
 * `{{ALLOWED_PAGE_TEMPLATE_IDS_JSON}}` (06 §5 builder notes: "the recommendable
 * templates … exported as `LLM_ALLOWED_TEMPLATES`"). One coherent contract,
 * shared by the prompt and the response referential check (both receive this
 * same list via `AllowedVocabularies`):
 *
 *   - the prompt offers ONLY templates the model may recommend per table;
 *   - the referential membership check (`referential.ts` §7.3) therefore
 *     rejects every non-recommendable id — the tool surfaces (`page-builder`,
 *     `page-wizard`, `page-settings`) fall out as `LLM_UNKNOWN_TEMPLATE`, and
 *     `page-crud` keeps its bespoke "always generated" rejection (06 §5
 *     decision 6), which fires before the membership test.
 *
 * Renderability stays a superset: `pageTemplateRegistry` still carries the
 * non-recommendable templates for Studio's picker and the render layer.
 */
export const LLM_ALLOWED_PAGE_TEMPLATES: readonly string[] = sortedUnique(
  pageTemplateDefinitions
    .filter((template) => template.recommendable)
    .map((template) => template.id),
);

/**
 * Alias under the name used in 06-llm-assist.md §5's builder notes
 * (`LLM_ALLOWED_TEMPLATES`). Same value as {@link LLM_ALLOWED_PAGE_TEMPLATES};
 * exported so the prompt builder resolves regardless of which spelling it imports.
 */
export const LLM_ALLOWED_TEMPLATES: readonly string[] = LLM_ALLOWED_PAGE_TEMPLATES;

/* ---------------------------------------------------------------- widgets */

/**
 * Widget families the LLM composes dashboards from — every registered widget in
 * these families is a suggestable dashboard tile (KPI stats, charts, activity/
 * feed summaries). Families that render page bodies, overlays or chrome are not
 * dashboard analytics and are excluded (06 §5 decision 7 / the curated subset in
 * §5's builder notes).
 */
const LLM_DASHBOARD_WIDGET_FAMILIES: ReadonlySet<WidgetFamily> = new Set<WidgetFamily>([
  'kpi',
  'charts',
  'feeds',
]);

/**
 * Predicate deciding whether a registered widget may be recommended on a
 * generated dashboard. Data-editing widgets are never suggestable — a generated
 * dashboard is read-only analytics, so a mutating tile (e.g. the `feeds`
 * family's `notification-feed`, which marks items read) is excluded even though
 * its family otherwise qualifies. Whole analytics families qualify; from the
 * `tables` family only read-only list *summary tiles* (e.g. `mini-table`)
 * qualify — the interactive `data-grid`, its inline chrome (`pagination-footer`,
 * `bulk-action-toolbar`) and the single-record `detail-key-value` are page-CRUD
 * building blocks, not dashboard widgets, and the `widget-missing` system
 * fallback is never suggestable.
 */
function isLlmDashboardWidget(definition: WidgetDefinition): boolean {
  if (definition.capabilities?.editsData === true) return false;
  // Suggestable requires bindable: see {@link isBindable}.
  if (!isBindable(definition)) return false;
  if (LLM_DASHBOARD_WIDGET_FAMILIES.has(definition.family)) return true;
  return (
    definition.family === 'tables' &&
    definition.placement === 'grid' &&
    dataContractIncludes(definition.dataContract, 'record-list')
  );
}

/**
 * Curated dashboard-widget subset of the registry, injected as
 * `{{ALLOWED_WIDGET_IDS_JSON}}`. Derived from `widgetRegistry` so the prompt and
 * the render layer can never drift (06 §5 builder notes).
 */
export const LLM_ALLOWED_WIDGETS: readonly string[] = sortedUnique(
  [...widgetRegistry.values()].filter(isLlmDashboardWidget).map((definition) => definition.id),
);

/**
 * Widget id → the data shapes that widget accepts, for every id in
 * {@link LLM_ALLOWED_WIDGETS}.
 *
 * Injected into `@adminium/llm`'s apply planner the same way the allow-lists
 * above are injected into the prompt builder and the referential checks — as
 * plain data, so the LLM package keeps its "no dependency on the render layer"
 * rule (01 §2.3).
 *
 * The planner needs it because a query descriptor's `shape` is what decides
 * which envelope the server returns, and picking that from the bound columns
 * alone produced tiles the widget could not read: every KPI card the model gave
 * a `timeColumn` was bound as `timeseries` (a `{points}` series) when
 * `kpi-stat-card` declares `metric+delta` (a `{value, prior}` scalar), so the
 * card rendered "Unexpected data shape".
 */
export const LLM_WIDGET_DATA_CONTRACTS: Readonly<Record<string, readonly DataShape[]>> =
  Object.freeze(
    Object.fromEntries(
      LLM_ALLOWED_WIDGETS.map((id) => [
        id,
        Object.freeze(contractShapes(widgetRegistry.get(id)?.dataContract ?? 'static')),
      ]),
    ),
  );

/* -------------------------------------------------------------- semantics */

/**
 * Status-pill / enum tones the LLM may assign when classifying enum values
 * (06 §5 decision 3, mirrored by the frozen `Tone` enum in the response schema,
 * 06 §6). A closed set: every enrichment tone maps onto a tone the widgets
 * runtime can render (`llm-allowlist.test.ts` asserts the subset relation
 * against the shared widget-config tone vocabulary).
 */
export type LlmSemanticTone = 'pos' | 'warn' | 'danger' | 'accent' | 'muted';

export const LLM_ALLOWED_SEMANTICS: readonly LlmSemanticTone[] = [
  'pos',
  'warn',
  'danger',
  'accent',
  'muted',
];

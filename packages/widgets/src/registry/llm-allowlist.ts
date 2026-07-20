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
import type { DataShape } from '../page-config/index.js';

/* ------------------------------------------------------------------ helpers */

function sortedUnique(ids: Iterable<string>): readonly string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b, 'en'));
}

function dataContractIncludes(contract: DataShape | DataShape[], shape: DataShape): boolean {
  return Array.isArray(contract) ? contract.includes(shape) : contract === shape;
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

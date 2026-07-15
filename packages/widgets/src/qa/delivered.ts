/**
 * The aggregated set of Wave-1 widget definitions the QA harness (04-T17) runs
 * against — determinism, config-fuzz, four-state, story, and parity checks all
 * iterate this list.
 *
 * WHY THIS EXISTS SEPARATELY FROM `registry/index.ts`: the per-track definition
 * arrays (`barsRankingChartDefinitions`, `feedsTrackFDefinitions`, …) are
 * assembled into the shared `widgetRegistry` map by the GREEN LOOP, not by the
 * individual tracks (barrel discipline — avoids concurrent edits to the map).
 * The harness must exercise *every delivered widget* regardless of whether the
 * green loop has run yet, so it imports the per-track arrays directly here. When
 * a new track lands, add its exported array to `DELIVERED_ARRAYS` (one line) —
 * the same discipline the green loop follows for the registry map.
 *
 * The parity gate cross-checks this aggregate against both the annex catalog and
 * the live `widgetRegistry` (see registry-parity.test.ts).
 */
import { chartsWidgetDefinitions } from '../families/charts/definitions.js';
import { barsRankingChartDefinitions } from '../families/charts/bars-ranking-definitions.js';
import { distributionCorrelationChartDefinitions } from '../families/charts/definitions.distribution-correlation.js';
import { partWholeChartDefinitions } from '../families/charts/def.part-whole.js';
import { matrixGeoChartDefinitions } from '../families/charts/defs.matrix-geo.js';
import { timeFlowChartDefinitions } from '../families/charts/time-flow-definitions.js';
import { feedsTrackFDefinitions } from '../families/feeds/feeds-track-f.definitions.js';
import { kpiWidgetDefinitions } from '../families/kpi/definitions.js';
import { tablesWidgetDefinitions } from '../families/tables/definitions.js';
import { tablesTrackFDefinitions } from '../families/tables/tables-track-f.definitions.js';
import { buildRegistry } from '../registry/index.js';
import { widgetMissingDefinition } from '../registry/widget-missing.js';
import type { WidgetDefinition, WidgetFamily } from '../registry/types.js';

/** Every per-track definition array delivered so far, in family order. */
const DELIVERED_ARRAYS: readonly (readonly WidgetDefinition[])[] = [
  // kpi (M4 slice)
  kpiWidgetDefinitions,
  // charts (M4 slice + 04-T09 waves)
  chartsWidgetDefinitions,
  barsRankingChartDefinitions,
  distributionCorrelationChartDefinitions,
  partWholeChartDefinitions,
  matrixGeoChartDefinitions,
  timeFlowChartDefinitions,
  // tables (M4 slice + Track F)
  tablesWidgetDefinitions,
  tablesTrackFDefinitions,
  // feeds (Track F)
  feedsTrackFDefinitions,
];

/** Flat list of every delivered Wave-1 widget definition. */
export const deliveredDefinitions: readonly WidgetDefinition[] = DELIVERED_ARRAYS.flat();

/** Delivered definitions keyed by id (first-wins; duplicates surface in parity). */
export const deliveredById: ReadonlyMap<string, WidgetDefinition> = new Map(
  deliveredDefinitions.map((definition) => [definition.id, definition]),
);

/** Delivered ids grouped by family, in delivery order. */
export function deliveredIdsByFamily(): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const definition of deliveredDefinitions) {
    (grouped[definition.family] ??= []).push(definition.id);
  }
  return grouped;
}

/** Delivered ids for a single family. */
export function deliveredIdsFor(family: WidgetFamily): string[] {
  return deliveredDefinitions.filter((d) => d.family === family).map((d) => d.id);
}

/**
 * A registry built from every delivered definition plus the `widget-missing`
 * fallback — what the assembled `widgetRegistry` becomes once the GREEN LOOP
 * wires the tracks. Building it here also proves globally-unique ids
 * (`buildRegistry` throws `DuplicateWidgetIdError` on collision).
 */
export const qaRegistry: ReadonlyMap<string, WidgetDefinition> = buildRegistry([
  widgetMissingDefinition,
  ...deliveredDefinitions,
]);

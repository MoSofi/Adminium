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
import { boardsTrackDefinitions } from '../families/boards/boards-track.definitions.js';
import { calendarTrackDefinitions } from '../families/calendar/calendar-track.definitions.js';
import { chromeTrackDefinitions } from '../families/chrome/chrome-track.definitions.js';
import { communicationTrackDefinitions } from '../families/communication/communication-track.definitions.js';
import { blocksTrackDefinitions } from '../families/domain/blocks-track.definitions.js';
import { domainOpsTrackDefinitions } from '../families/domain/domain-ops-track.definitions.js';
import { domainTrackDefinitions } from '../families/domain/domain-track.definitions.js';
import { feedsTrackFDefinitions } from '../families/feeds/feeds-track-f.definitions.js';
import { formsTrackDefinitions } from '../families/forms/forms-track.definitions.js';
import { geoTrackDefinitions } from '../families/geo/geo-track.definitions.js';
import { kpiWidgetDefinitions } from '../families/kpi/definitions.js';
import { mediaTrackDefinitions } from '../families/media/media-track.definitions.js';
import { systemTrackDefinitions } from '../families/system/system-track.definitions.js';
import { tablesWidgetDefinitions } from '../families/tables/definitions.js';
import { tablesTrackFDefinitions } from '../families/tables/tables-track-f.definitions.js';
import { tablesTailDefinitions } from '../families/tables/tables-tail.definitions.js';
import { buildRegistry } from '../registry/index.js';
import { widgetMissingDefinition } from '../registry/widget-missing.js';
import type { WidgetDefinition, WidgetFamily } from '../registry/types.js';

/** Every per-track definition array delivered so far, in family order. */
const DELIVERED_ARRAYS: readonly (readonly WidgetDefinition[])[] = [
  // kpi (M4 slice + the M7 Wave-4 tail — annex §1 complete, 10/10)
  kpiWidgetDefinitions,
  // charts (M4 slice + 04-T09 waves)
  chartsWidgetDefinitions,
  barsRankingChartDefinitions,
  distributionCorrelationChartDefinitions,
  partWholeChartDefinitions,
  matrixGeoChartDefinitions,
  timeFlowChartDefinitions,
  // tables (M4 slice + Track F + the M7 Wave-4 TAIL that completes annex §3)
  tablesWidgetDefinitions,
  tablesTrackFDefinitions,
  tablesTailDefinitions,
  // feeds (Track F + the M7 Wave-4 tail — annex §4 complete, 7/7)
  feedsTrackFDefinitions,
  // calendar (Track CAL — M7 Wave 2 + the Wave-4 tail: legend filter, upcoming
  // feed, date-range-picker control, scheduled-jobs list)
  calendarTrackDefinitions,
  // boards (Track BOARDS — M7 Wave 2 + the Wave-4 tail: board-card and
  // inline-compose-card)
  boardsTrackDefinitions,
  // geo (TRACK COMM-GEO — M7 Wave 4; the last family to open. Importing this
  // array does NOT pull Leaflet: it is metadata only, and the map component
  // dynamically imports Leaflet inside its mount effect — acceptance #3.)
  geoTrackDefinitions,
  // media (Track MEDIA — M7 Wave 3; the file-browser exit criterion)
  mediaTrackDefinitions,
  // communication (Track COMM — M7 Wave 3 + the Wave-4 typing/call tail)
  communicationTrackDefinitions,
  // domain (Track DOMAIN — M7 Wave 3; the two exit-criteria widgets)
  domainTrackDefinitions,
  // domain (TRACK BUILDER — M7 Wave 4; the §13 DOCUMENT half: `document-canvas`
  // and its 22-block shared library. Metadata only: the blocks load through
  // `blocks-track-components.js` behind a dynamic import, so importing this
  // array costs no component code — acceptance #3.)
  blocksTrackDefinitions,
  // domain (TRACK OPS — M7 Wave 4; the §13 OPS/billing/API/marketing tail: the
  // eighteen ids that close the annex catalog. Metadata only, same as above —
  // the cards load through `domain-ops-track-components.js` behind a dynamic
  // import, so importing this array costs no component code.)
  domainOpsTrackDefinitions,
  // system (Track FCS — M7 Wave 3; annex §12)
  systemTrackDefinitions,
  // chrome (Track FCS — M7 Wave 3; annex §11)
  chromeTrackDefinitions,
  // forms (Track FCS — M7 Wave 3; annex §10)
  formsTrackDefinitions,
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

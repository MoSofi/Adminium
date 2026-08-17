// SPDX-License-Identifier: AGPL-3.0-only
import { lazy } from 'react';

import {
  mapBubbleConfigSchema,
  mapBubbleDemoData,
  mapChoroplethGridConfigSchema,
  mapChoroplethGridDemoData,
} from './geo-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * TRACK COMM-GEO — `geo` family registry metadata (annex §7). Metadata only: the
 * map components load through the `geo-track-components` barrel via
 * `lazy(() => import(...))`, so the family stays in ONE lazy chunk and the
 * registry metadata never eagerly pulls the component code — let alone Leaflet —
 * into the shared bundle (04 §2.3; acceptance #3, gated by qa/chunk-budget.test.ts,
 * which walks the transitive static-import graph from this module and asserts it
 * never reaches 'leaflet'). Schemas + `demoData` come from the PURE `geo-config.ts`
 * for the same reason.
 *
 * The GREEN LOOP spreads `geoTrackDefinitions` into the registry map. Widget ids
 * match the annex catalog exactly (acceptance #1).
 *
 * Sizing is the annex's grid note converted to 40px half-units
 * (04 §6.1: `h = round(annexRows × 2)`); widths map 1:1.
 */

export const mapBubbleDefinition: WidgetDefinition = defineWidget({
  id: 'map-bubble',
  family: 'geo',
  component: lazy(() => import('./geo-track-components.js').then((m) => ({ default: m.MapBubbleWidget }))),
  configSchema: mapBubbleConfigSchema,
  dataContract: 'geo-points',
  sizing: { minW: 6, minH: 8, defaultW: 8, defaultH: 10 }, // annex "min 6×4, default 8×5"
  placement: 'grid',
  skeleton: 'block',
  // The ranked companion is a plain value table — CSV export is meaningful even
  // though the tiles/markers themselves are not rows.
  capabilities: { exportCsv: true },
  demoData: mapBubbleDemoData,
  descriptionKey: 'widgets.geo.mapBubble.description',
});

export const mapChoroplethGridDefinition: WidgetDefinition = defineWidget({
  id: 'map-choropleth-grid',
  family: 'geo',
  component: lazy(() => import('./geo-track-components.js').then((m) => ({ default: m.MapChoroplethGridWidget }))),
  configSchema: mapChoroplethGridConfigSchema,
  dataContract: 'geo-points',
  // The annex cross-lists this as `chart-choropleth-grid` ("min 4×3, default
  // 6×3"), so the sizing matches that id's registration exactly — same visual,
  // same footprint.
  sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 6 },
  placement: 'grid',
  skeleton: 'chart',
  // Matched to `chart-choropleth-grid`'s registration too: the annex cross-lists
  // ONE visual under two ids, so anything that differs between them is drift.
  capabilities: { exportPng: true },
  demoData: mapChoroplethGridDemoData,
  descriptionKey: 'widgets.geo.mapChoroplethGrid.description',
});

export const geoTrackDefinitions: readonly WidgetDefinition[] = [mapBubbleDefinition, mapChoroplethGridDefinition];

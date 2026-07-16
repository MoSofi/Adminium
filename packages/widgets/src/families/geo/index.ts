/**
 * `geo` family public surface (annex §7) — the bubble map and the region-coded
 * tilegram, plus the TRACK COMM-GEO registry metadata. Component code is also
 * reachable through each definition's `lazy()` ref, so the registry still emits
 * one chunk per family (04 §2.3); this barrel is for direct template/story
 * composition and tests. Registry metadata lives in `geo-track.definitions.ts`;
 * schemas + demo generators in `geo-config.ts`.
 *
 * Note that importing this barrel does NOT pull Leaflet: `MapBubble.tsx` loads
 * it dynamically inside its mount effect (acceptance #3).
 */
export {
  MapBubble,
  MapBubbleWidget,
  mapBubbleConfigSchema,
  mapBubbleDemoData,
  type MapBubbleConfig,
  type MapBubbleProps,
} from './MapBubble.js';
export {
  MapChoroplethGrid,
  MapChoroplethGridWidget,
  mapChoroplethGridConfigSchema,
  mapChoroplethGridDemoData,
  type MapChoroplethGridConfig,
  type MapChoroplethGridProps,
} from './MapChoroplethGrid.js';
export {
  BUBBLE_MAX_RADIUS,
  BUBBLE_MIN_RADIUS,
  CARTO_ATTRIBUTION,
  CARTO_TILES,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  GEO_DEMO_EPOCH,
  bubbleRadius,
  geoPointsOf,
  localeOf,
  maxMetric,
  metricKeysOf,
  metricValue,
  mulberry32,
  plottablePoints,
  sourceOf,
  type GeoFieldConfig,
  type GeoPoint,
} from './geo-lib.js';
export { initialView } from './geo-config.js';
export {
  geoTrackDefinitions,
  mapBubbleDefinition,
  mapChoroplethGridDefinition,
} from './geo-track.definitions.js';

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `geo` family component barrel — the single lazy-import target for this
 * family's definitions, so the registry metadata graph reaches the
 * @adminium/ui-heavy map components only through a dynamic `import()` boundary
 * (one lazy chunk for the family, 04 §2.3). Mirrors the media/communication
 * `*-components.ts` convention.
 *
 * Leaflet is NOT reachable from here either: `MapBubble.tsx` imports it
 * dynamically inside its mount effect, so it gets its own chunk, fetched when a
 * bubble map actually mounts (acceptance #3 — "Leaflet code is absent unless
 * map-bubble is placed"). A page that places only `map-choropleth-grid` pulls
 * this chunk without pulling Leaflet.
 */
export { MapBubbleWidget } from './MapBubble.js';
export { MapChoroplethGridWidget } from './MapChoroplethGrid.js';

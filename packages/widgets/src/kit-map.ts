// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The map, for the project UI kit's `MapView` and for a record's place and
 * area fields: the map component and the shapes it draws, apart from the
 * widget registry. The map library itself loads only with the first map
 * drawn, and never while maps are switched off.
 */
export { MapBubble, type MapBubbleProps } from './families/geo/MapBubble.js';
export type { GeoPoint } from './families/geo/geo-lib.js';
export * from './families/geo/map-shapes.js';
export * from './families/geo/place-value.js';
export { mapServerOf } from './registry/map-server.js';
// For a host that is not the dashboard (the kit on an app's own screen): it says where maps come from itself.
export { WidgetRuntimeProvider } from './frame/WidgetRuntimeContext.js';
export type { WidgetRuntimeEnv } from './registry/offline.js';

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The map, for the project UI kit's `MapView`: the map component and its
 * point shape, apart from the widget registry. Imported only through a
 * dynamic `import()`, so the map library loads with the first map drawn.
 */
export { MapBubble, type MapBubbleProps } from './families/geo/MapBubble.js';
export type { GeoPoint } from './families/geo/geo-lib.js';

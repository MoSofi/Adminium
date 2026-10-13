// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MapLibre's TYPE, and nothing else: no code of the library is reached from
 * here, so this file may be imported by anything without putting the map
 * library on a page. `MapBubble.tsx` is the one file that loads the library;
 * it hands it to `map-engine.ts`, and both take its type from here (the engine
 * taking it from `MapBubble.tsx` made the two import each other).
 */
export type MapLibreModule = typeof import('maplibre-gl');

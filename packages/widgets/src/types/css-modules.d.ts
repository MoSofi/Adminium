// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ambient declarations for the two imports of `families/geo/MapBubble.tsx`
 * that TypeScript has no loader for. Same pattern as
 * packages/ui/.storybook/css.d.ts.
 *
 * `maplibre-gl/dist/maplibre-gl.css` is MapLibre's stylesheet (it lays out the
 * canvas, the pins and the map's own buttons). `…-worker.mjs?worker&url` is
 * the bundler's address for MapLibre's worker, built into this app and served
 * from its own origin: MapLibre otherwise looks for the file beside its own
 * module, where a bundle has none.
 *
 * Declaring a module does not IMPORT anything: both imports stay inside the
 * map's mount effect, so they are fetched only when a map is drawn (acceptance
 * #3), and a runner that stubs CSS (vitest's default `css: false`) resolves the
 * stylesheet to an empty module.
 */
declare module '*.css';

declare module '*?worker&url' {
  const url: string;
  export default url;
}

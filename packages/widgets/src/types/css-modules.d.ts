// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ambient declaration for side-effect CSS imports. `families/geo/MapBubble.tsx`
 * dynamically imports `leaflet/dist/leaflet.css` (Leaflet's stylesheet positions
 * the tile panes; without it the map is a pile of stacked images), and
 * TypeScript has no loader for `.css`, so the specifier needs a module to
 * resolve to. Same pattern as packages/ui/.storybook/css.d.ts.
 *
 * Declaring the module does not IMPORT anything: the import stays inside the map
 * widget's mount effect, so the stylesheet is fetched only when a bubble map
 * mounts (acceptance #3), and a runner that stubs CSS (vitest's default
 * `css: false`) resolves it to an empty module.
 */
declare module '*.css';

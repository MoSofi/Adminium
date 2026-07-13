export { Badge, badgeVariants } from './Badge.js';
export type { BadgeProps } from './Badge.js';
// NB: the `Tone` union is intentionally NOT re-exported here — the package
// barrel (`export *` per component) would collide with the identical `Tone`
// exported by components/icon-tile. Import it from '../badge/Badge.js'
// inside the package; consumers get `Tone` from the barrel via icon-tile
// until lib/tones.ts (03-component-library.md §7.6) becomes its single home.

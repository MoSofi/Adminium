export { Badge, badgeVariants } from './Badge.js';
export type { BadgeProps } from './Badge.js';
// NB: the `Tone` union is intentionally NOT re-exported here — consumers get
// it from the barrel via components/icon-tile. Both re-export the SAME
// declaration from lib/tones.ts (its single home, 03-component-library.md
// §7.6); keeping one barrel path avoids duplicate `export *` surface.

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Grid-track layout schema surface (04-widget-registry.md §6.1).
 *
 * The canonical `layoutItemSchema` / `pageLayoutSchema` Zod definitions live in
 * the pure-Zod leaf `../page-config/layout.ts` — that module is import-frozen
 * to `zod` only so `@adminium/engine/config` and the server can consume the
 * schema without pulling React, dnd-kit, or node builtins (leaf-purity.test.ts).
 * The grid cannot be that source (it imports React + dnd-kit), so re-exporting
 * the leaf here keeps ONE canonical schema while giving the grid track — and the
 * layout-persistence track (04-T13), which references it — a stable
 * `grid/layout-schema` import point per the wave brief. There is deliberately no
 * second Zod definition to drift from.
 */
export {
  layoutItemSchema,
  pageLayoutSchema,
  // Re-exported, not restated: this was a hand-copied `= 24` sitting directly
  // under a header comment promising no second definition to drift from.
  MAX_H,
  type LayoutItem,
  type PageLayout,
} from '../page-config/layout.js';

/**
 * The subset of a widget's registry `sizing` the grid enforces on drag/resize:
 * a widget can never be resized below `minW × minH` (04 §6.1). The grid takes
 * this as an injected resolver (`getSizing`) rather than importing the registry,
 * so the grid stays free of widget component code / family chunks (04 §2.3).
 */
export interface MinSize {
  /** Minimum width in 12-col grid units. */
  minW: number;
  /** Minimum height in 40 px half-units. */
  minH: number;
}

/**
 * Fallback when the host supplies no per-widget `getSizing` resolver — the
 * NO-RESOLVER default, not the identity. 1×1 was effectively "no floor": a
 * single column by 40px, which is smaller than the card's own header. 2×2 is
 * the smallest cell that can hold a padded card with a title and still read as
 * a widget; anything that genuinely wants to be smaller declares its own
 * `sizing` in the registry, which every real widget does.
 */
export const DEFAULT_MIN_SIZE: MinSize = { minW: 2, minH: 2 };

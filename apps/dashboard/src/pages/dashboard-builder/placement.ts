// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Builder-local layout placement helpers (04-widget-registry.md §6.2 "Adding
 * widgets"). The builder needs to place, clone, remove and re-configure grid
 * items on the working-copy layout without touching the grid internals Track
 * GRID owns (`packages/widgets/src/grid`).
 *
 * Placement itself (`findFirstFit`) and top-gravity compaction (`compactVertical`)
 * are Track GRID's exported geometry (`@adminium/widgets`); this module reuses
 * them so a builder insertion and a dropped-drag placement normalize to the same
 * coordinates, and only owns the builder-level insert/duplicate/remove/config
 * transforms on top.
 */

import {
  GRID_COLUMNS,
  compactVertical,
  findFirstFit,
  type WidgetDefinition,
} from '@adminium/widgets';
import type { LayoutItem, PageLayout } from '@adminium/widgets/page-config';

/** Reserved config key carrying builder-locked config paths (04 §9 Tier A). */
export const LOCKED_CONFIG_KEY = '__locked';

let idCounter = 0;

/** Fresh, collision-free layout-item instance id (nanoid-shaped string). */
export function newInstanceId(): string {
  const cryptoObj: Crypto | undefined = globalThis.crypto;
  if (cryptoObj !== undefined && typeof cryptoObj.randomUUID === 'function') {
    return `w_${cryptoObj.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  }
  idCounter += 1;
  return `w_${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Schema-default config for a widget id, from the shared config-schema defaults. */
function defaultConfigFor(definition: WidgetDefinition): Record<string, unknown> {
  const parsed = definition.configSchema.safeParse({});
  return parsed.success && typeof parsed.data === 'object' && parsed.data !== null
    ? { ...(parsed.data as Record<string, unknown>) }
    : {};
}

/**
 * Insert a widget at its registry default size, placed at `findFirstFit`, then
 * top-gravity compacted. Returns the new layout and the created item's id.
 */
export function insertWidget(
  layout: PageLayout,
  definition: WidgetDefinition,
): { layout: PageLayout; itemId: string } {
  const w = Math.min(definition.sizing.defaultW, GRID_COLUMNS);
  const h = definition.sizing.defaultH;
  const spot = findFirstFit(layout, w, h);
  const itemId = newInstanceId();
  const item: LayoutItem = {
    i: itemId,
    widget: definition.id,
    x: spot.x,
    y: spot.y,
    w,
    h,
    config: defaultConfigFor(definition),
  };
  return {
    layout: { ...layout, items: compactVertical([...layout.items, item]) },
    itemId,
  };
}

/** Clone an item (new id, re-placed at `findFirstFit`), preserving its config. */
export function duplicateItem(
  layout: PageLayout,
  itemId: string,
): { layout: PageLayout; itemId: string } {
  const source = layout.items.find((item) => item.i === itemId);
  if (source === undefined) return { layout, itemId };
  const spot = findFirstFit(layout, source.w, source.h);
  const clonedId = newInstanceId();
  const clone: LayoutItem = {
    ...source,
    i: clonedId,
    x: spot.x,
    y: spot.y,
    config: { ...source.config },
  };
  return {
    layout: { ...layout, items: compactVertical([...layout.items, clone]) },
    itemId: clonedId,
  };
}

/** Drop an item and close the gap it left (top-gravity compaction). */
export function removeItem(layout: PageLayout, itemId: string): PageLayout {
  const remaining = layout.items.filter((item) => item.i !== itemId);
  if (remaining.length === layout.items.length) return layout;
  return { ...layout, items: compactVertical(remaining) };
}

/** Replace one item's config (live inspector edit). */
export function updateItemConfig(
  layout: PageLayout,
  itemId: string,
  config: Record<string, unknown>,
): PageLayout {
  return {
    ...layout,
    items: layout.items.map((item) => (item.i === itemId ? { ...item, config } : item)),
  };
}

/** Locked config paths stamped on an item (04 §9 Tier A derived/LLM-locked). */
export function lockedPathsOf(config: Record<string, unknown> | undefined): string[] {
  const raw = config?.[LOCKED_CONFIG_KEY];
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * Palette catalog helpers (04-widget-registry.md §6.2 "Adding widgets"):
 * group the registry's grid-placeable widgets by family for the family-grouped,
 * searchable palette. Metadata-only — the palette renders each entry's
 * demo-data preview from the definition itself.
 */

import {
  WIDGET_FAMILIES,
  widgetRegistry,
  WIDGET_MISSING_ID,
  type WidgetDefinition,
  type WidgetFamily,
} from '@adminium/widgets';

export interface PaletteGroup {
  family: WidgetFamily;
  widgets: WidgetDefinition[];
}

/** Only `grid`-placement widgets belong on a dashboard grid palette. */
function isPaletteWidget(definition: WidgetDefinition): boolean {
  return definition.placement === 'grid' && definition.id !== WIDGET_MISSING_ID;
}

/**
 * Grid-placeable widgets grouped by family, in the canonical family order.
 * Empty families are omitted so the palette only shows families that ship
 * widgets in this build.
 */
export function paletteGroups(
  registry: ReadonlyMap<string, WidgetDefinition> = widgetRegistry,
): PaletteGroup[] {
  const byFamily = new Map<WidgetFamily, WidgetDefinition[]>();
  for (const definition of registry.values()) {
    if (!isPaletteWidget(definition)) continue;
    const bucket = byFamily.get(definition.family) ?? [];
    bucket.push(definition);
    byFamily.set(definition.family, bucket);
  }
  return WIDGET_FAMILIES.flatMap((family) => {
    const widgets = byFamily.get(family);
    if (widgets === undefined || widgets.length === 0) return [];
    return [{ family, widgets: [...widgets].sort((a, b) => a.id.localeCompare(b.id)) }];
  });
}

/** Total grid-placeable widget count across all families. */
export function paletteWidgetCount(groups: readonly PaletteGroup[]): number {
  return groups.reduce((total, group) => total + group.widgets.length, 0);
}

/**
 * Filter palette groups by a free-text query, matched against each widget's id,
 * family and resolved display name (`nameOf`). Empty groups are dropped.
 */
export function filterPaletteGroups(
  groups: readonly PaletteGroup[],
  query: string,
  nameOf: (definition: WidgetDefinition) => string,
): PaletteGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...groups];
  return groups.flatMap((group) => {
    const widgets = group.widgets.filter((definition) => {
      const haystack = `${definition.id} ${definition.family} ${nameOf(definition)}`.toLowerCase();
      return haystack.includes(needle);
    });
    return widgets.length > 0 ? [{ family: group.family, widgets }] : [];
  });
}

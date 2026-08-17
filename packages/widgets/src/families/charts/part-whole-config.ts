// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `charts` part-to-whole group — Zod config schemas, config types and the pure
 * §3-envelope→primitive input mappers, split out of `def.part-whole.ts` so the
 * component wrappers (`PartWholeWidgets.tsx`) can import them WITHOUT importing
 * the definitions module (which lazy-loads those same components) — that would
 * form an import cycle (01 §2.3, enforced by dependency-cruiser). The
 * definitions module re-exports everything here for back-compat.
 *
 * Metadata only: never imports the @adminium/charts chart primitives, so config
 * validation and the mappers stay importable without pulling component code.
 */
import { z } from 'zod';

import { asCategorical } from '../../lib/shapes.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';
import { asFlows, asMatrix, asTwoLevelTree } from './part-whole-shapes.js';

/** Per-widget empty-state copy default — `ui` bundle key paths resolved by
 * WidgetFrame's empty-state translator. Static full-key literals on purpose:
 * the i18n coverage guard only counts statically visible `widgets.*` refs. */
function emptyStateField(titleKey: string, bodyKey: string) {
  return z
    .object({
      icon: z.string().optional(),
      titleKey: z.string().optional(),
      bodyKey: z.string().optional(),
    })
    .default({ titleKey, bodyKey });
}

const metricFormat = z.enum(['plain', 'compact', 'currency', 'percent', 'duration']);

// --- chart-treemap -----------------------------------------------------------

export const chartTreemapConfigSchema = widgetSharedConfigSchema.extend({
  /** Slices beyond this fold into a trailing "Other" tile (annex §2 `depth`/labelling). */
  maxTiles: z.number().int().min(2).max(24).default(12),
  metricFormat: metricFormat.default('compact'),
  height: z.number().int().min(120).max(600).default(260),
  emptyState: emptyStateField('widgets.charts.treemap.emptyTitle', 'widgets.charts.treemap.emptyBody'),
});
export type ChartTreemapConfig = z.infer<typeof chartTreemapConfigSchema>;

export function treemapInputsOf(data: unknown): { label: string; value: number }[] | null {
  const categorical = asCategorical(data);
  if (categorical === null || categorical.items.length === 0) return null;
  return categorical.items.map((item) => ({ label: item.label, value: item.value }));
}

// --- chart-sunburst ----------------------------------------------------------

export const chartSunburstConfigSchema = widgetSharedConfigSchema.extend({
  size: z.number().int().min(120).max(400).default(220),
  showLegend: z.boolean().default(true),
  emptyState: emptyStateField('widgets.charts.sunburst.emptyTitle', 'widgets.charts.sunburst.emptyBody'),
});
export type ChartSunburstConfig = z.infer<typeof chartSunburstConfigSchema>;

export function sunburstInputsOf(data: unknown): { label: string; children: { label: string; value: number }[] }[] | null {
  return asTwoLevelTree(data);
}

// --- chart-funnel ------------------------------------------------------------

export const chartFunnelConfigSchema = widgetSharedConfigSchema.extend({
  variant: z.enum(['horizontal', 'stepped']).default('stepped'),
  showStepConversion: z.boolean().default(true),
  overallFooter: z.boolean().default(true),
  metricFormat: metricFormat.default('compact'),
  height: z.number().int().min(120).max(600).default(240),
  emptyState: emptyStateField('widgets.charts.funnel.emptyTitle', 'widgets.charts.funnel.emptyBody'),
});
export type ChartFunnelConfig = z.infer<typeof chartFunnelConfigSchema>;

export function funnelInputsOf(data: unknown): { label: string; value: number }[] | null {
  const categorical = asCategorical(data);
  if (categorical === null || categorical.items.length === 0) return null;
  return categorical.items.map((item) => ({ label: item.label, value: item.value }));
}

// --- chart-radial-bar --------------------------------------------------------

export const chartRadialBarConfigSchema = widgetSharedConfigSchema.extend({
  size: z.number().int().min(96).max(320).default(168),
  /** Rings rendered (annex: ≤4). Extra categories are dropped. */
  maxRings: z.number().int().min(1).max(6).default(4),
  showLegend: z.boolean().default(true),
  emptyState: emptyStateField('widgets.charts.radialBar.emptyTitle', 'widgets.charts.radialBar.emptyBody'),
});
export type ChartRadialBarConfig = z.infer<typeof chartRadialBarConfigSchema>;

export function radialBarInputsOf(data: unknown, maxRings: number): { label: string; value: number }[] | null {
  const categorical = asCategorical(data);
  if (categorical === null || categorical.items.length === 0) return null;
  return categorical.items.slice(0, maxRings).map((item) => ({ label: item.label, value: item.value }));
}

// --- chart-radar -------------------------------------------------------------

export const chartRadarConfigSchema = widgetSharedConfigSchema.extend({
  size: z.number().int().min(120).max(360).default(200),
  levels: z.number().int().min(3).max(6).default(4),
  showLegend: z.boolean().default(true),
  emptyState: emptyStateField('widgets.charts.radar.emptyTitle', 'widgets.charts.radar.emptyBody'),
});
export type ChartRadarConfig = z.infer<typeof chartRadarConfigSchema>;

export function radarInputsOf(
  data: unknown,
): { axes: string[]; series: { label: string; values: number[] }[] } | null {
  const matrix = asMatrix(data);
  if (matrix === null) return null;
  const series = matrix.colKeys.map((label, ci) => ({
    label,
    values: matrix.rowKeys.map((_, ri) => matrix.cells[ri]?.[ci] ?? 0),
  }));
  return { axes: matrix.rowKeys, series };
}

// --- chart-chord -------------------------------------------------------------

export const chartChordConfigSchema = widgetSharedConfigSchema.extend({
  size: z.number().int().min(140).max(400).default(220),
  /** Cap on nodes shown around the ring (annex `nodeLimit`). */
  nodeLimit: z.number().int().min(2).max(12).default(8),
  showLegend: z.boolean().default(true),
  emptyState: emptyStateField('widgets.charts.chord.emptyTitle', 'widgets.charts.chord.emptyBody'),
});
export type ChartChordConfig = z.infer<typeof chartChordConfigSchema>;

export function chordInputsOf(
  data: unknown,
  nodeLimit: number,
): { nodes: { id: string; label: string }[]; links: { from: string; to: string; weight: number }[] } | null {
  const flows = asFlows(data);
  if (flows === null) return null;
  const nodes = flows.nodes.slice(0, nodeLimit);
  const ids = new Set(nodes.map((n) => n.id));
  const links = flows.links.filter((l) => ids.has(l.from) && ids.has(l.to));
  return { nodes, links };
}

// --- chart-wordcloud ---------------------------------------------------------

export const chartWordcloudConfigSchema = widgetSharedConfigSchema.extend({
  maxTerms: z.number().int().min(5).max(80).default(40),
  minFontSize: z.number().int().min(8).max(40).default(13),
  maxFontSize: z.number().int().min(16).max(72).default(40),
  height: z.number().int().min(120).max(500).default(200),
  emptyState: emptyStateField('widgets.charts.wordcloud.emptyTitle', 'widgets.charts.wordcloud.emptyBody'),
});
export type ChartWordcloudConfig = z.infer<typeof chartWordcloudConfigSchema>;

export function wordcloudInputsOf(data: unknown, maxTerms: number): { term: string; weight: number }[] | null {
  const categorical = asCategorical(data);
  if (categorical === null || categorical.items.length === 0) return null;
  return categorical.items.slice(0, maxTerms).map((item) => ({ term: item.label, weight: item.value }));
}

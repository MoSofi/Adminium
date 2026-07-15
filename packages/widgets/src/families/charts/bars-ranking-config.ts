/**
 * Config schemas for the "bars & ranking" chart group (04-T09): chart-bullet,
 * chart-ranking-bars, chart-pareto, chart-waterfall, chart-marimekko,
 * chart-stacked-bar-100, chart-slope. Each extends `widgetSharedConfigSchema`
 * and ships a per-widget empty-state default so WidgetFrame renders tailored
 * empty copy (04 §4). Pure module — no chart-primitive imports — so it is
 * validated independently of the @adminium/charts build.
 */
import { z } from 'zod';

import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/** Per-widget empty-state copy default (04 §4). Values are i18n keys the
 * dashboard resolves; passed through raw by WidgetHost, so readable English
 * doubles as the fallback until the catalog entries land. */
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

export const chartBulletConfigSchema = widgetSharedConfigSchema.extend({
  metricFormat: metricFormat.default('compact'),
  height: z.number().int().min(80).max(600).default(200),
  emptyState: emptyStateField('No goals to track', 'Add measures with targets to compare against.'),
});
export type ChartBulletConfig = z.infer<typeof chartBulletConfigSchema>;

export const chartRankingBarsConfigSchema = widgetSharedConfigSchema.extend({
  /** Top-N cap (annex `n`). */
  n: z.number().int().min(1).max(50).default(6),
  metricFormat: metricFormat.default('compact'),
  height: z.number().int().min(80).max(600).default(220),
  emptyState: emptyStateField('Nothing to rank', 'No records matched this breakdown yet.'),
});
export type ChartRankingBarsConfig = z.infer<typeof chartRankingBarsConfigSchema>;

export const chartParetoConfigSchema = widgetSharedConfigSchema.extend({
  /** Cumulative cutline fraction 0..1 (annex default 0.8); null hides it. */
  cutline: z.number().min(0).max(1).nullable().default(0.8),
  smooth: z.boolean().default(false),
  axis: z.boolean().default(true),
  metricFormat: metricFormat.default('compact'),
  height: z.number().int().min(80).max(600).default(240),
  emptyState: emptyStateField('No categories to chart', 'No grouped counts were returned for this range.'),
});
export type ChartParetoConfig = z.infer<typeof chartParetoConfigSchema>;

export const chartWaterfallConfigSchema = widgetSharedConfigSchema.extend({
  axis: z.boolean().default(true),
  metricFormat: metricFormat.default('compact'),
  height: z.number().int().min(80).max(600).default(260),
  emptyState: emptyStateField('No movement to bridge', 'No start, change, or total steps were found.'),
});
export type ChartWaterfallConfig = z.infer<typeof chartWaterfallConfigSchema>;

export const chartMarimekkoConfigSchema = widgetSharedConfigSchema.extend({
  /** Minimum segment height (px) to show its in-cell label (annex `labelThreshold`). */
  labelThreshold: z.number().int().min(0).max(120).default(18),
  height: z.number().int().min(80).max(600).default(260),
  emptyState: emptyStateField('No mix to break down', 'No two-level breakdown was returned for this range.'),
});
export type ChartMarimekkoConfig = z.infer<typeof chartMarimekkoConfigSchema>;

export const chartStackedBar100ConfigSchema = widgetSharedConfigSchema.extend({
  showTotal: z.boolean().default(true),
  legendColumns: z.number().int().min(1).max(4).default(2),
  gapPx: z.number().int().min(0).max(12).default(2),
  showLegend: z.boolean().default(true),
  metricFormat: metricFormat.default('compact'),
  emptyState: emptyStateField('No shares to split', 'No parts were returned for this breakdown.'),
});
export type ChartStackedBar100Config = z.infer<typeof chartStackedBar100ConfigSchema>;

export const chartSlopeConfigSchema = widgetSharedConfigSchema.extend({
  /** Period axis captions [A, B] (annex `periodLabels`). */
  periodLabels: z.tuple([z.string(), z.string()]).optional(),
  metricFormat: metricFormat.default('compact'),
  height: z.number().int().min(80).max(600).default(260),
  emptyState: emptyStateField('No period shift to show', 'No before/after values were returned to compare.'),
});
export type ChartSlopeConfig = z.infer<typeof chartSlopeConfigSchema>;

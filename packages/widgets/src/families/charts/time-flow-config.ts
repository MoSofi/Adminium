/**
 * Config Zod schemas for the M7 "time, forecast & flow" charts family group
 * (04-T09; annex §2 per-widget `Config` lists). Pure module — no chart
 * primitives, no React — so the schemas + their per-widget default empty copy
 * can be validated independently of the (green-loop-assembled) component
 * barrel. Every schema `.extend()`s the shared config (04 §2.1) and defaults a
 * per-widget `emptyState` pointing at the i18n copy keys.
 */
import { z } from 'zod';

import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * Per-widget empty-state copy default (04 §4 — per-widget empty copy). The
 * default is a fully-resolved object because `ZodDefault` returns the default
 * verbatim without re-parsing nested field defaults. Values are `ui` bundle
 * key paths, resolved by WidgetFrame's empty-state translator; static
 * full-key literals on purpose — the i18n coverage guard only counts
 * statically visible `widgets.*` refs.
 */
function emptyStateField(titleKey: string, bodyKey: string) {
  return z
    .object({
      icon: z.string().optional(),
      titleKey: z.string().optional(),
      bodyKey: z.string().optional(),
    })
    .default({ titleKey, bodyKey });
}

const heightField = z.number().int().min(80).max(600);

// --- chart-multiline ---------------------------------------------------------
export const chartMultilineConfigSchema = widgetSharedConfigSchema.extend({
  /** Series label at each line's end (annex §2 `seriesLabels`). */
  seriesLabels: z.boolean().default(true),
  axis: z.boolean().default(true),
  smooth: z.boolean().default(false),
  height: heightField.default(240),
  emptyState: emptyStateField('widgets.charts.multiline.emptyTitle', 'widgets.charts.multiline.emptyBody'),
});
export type ChartMultilineConfig = z.infer<typeof chartMultilineConfigSchema>;

// --- chart-stream ------------------------------------------------------------
export const chartStreamConfigSchema = widgetSharedConfigSchema.extend({
  /** Basis-spline vs straight bands (annex §2 `curve`). */
  curve: z.enum(['smooth', 'linear']).default('smooth'),
  legend: z.boolean().default(true),
  height: heightField.default(260),
  emptyState: emptyStateField('widgets.charts.stream.emptyTitle', 'widgets.charts.stream.emptyBody'),
});
export type ChartStreamConfig = z.infer<typeof chartStreamConfigSchema>;

// --- chart-forecast ----------------------------------------------------------
export const chartForecastConfigSchema = widgetSharedConfigSchema.extend({
  /** Steps projected beyond history (annex §2 `horizon`). */
  horizon: z.number().int().min(1).max(120).default(12),
  /** Confidence level for the band (annex §2 `confidence`, e.g. 0.9). */
  confidence: z.number().min(0.5).max(0.999).default(0.9),
  /** `provided` uses the payload's forecast/band; `linear` recomputes (annex §2 `method`). */
  method: z.enum(['provided', 'linear']).default('provided'),
  axis: z.boolean().default(true),
  height: heightField.default(260),
  emptyState: emptyStateField('widgets.charts.forecast.emptyTitle', 'widgets.charts.forecast.emptyBody'),
});
export type ChartForecastConfig = z.infer<typeof chartForecastConfigSchema>;

// --- chart-anomaly -----------------------------------------------------------
export const chartAnomalyConfigSchema = widgetSharedConfigSchema.extend({
  /** z-score threshold (annex §2 `sensitivity`). */
  sensitivity: z.number().min(1).max(4).default(2),
  /** Centered moving-average window for the expected line. */
  window: z.number().int().min(3).max(60).default(7),
  axis: z.boolean().default(true),
  height: heightField.default(220),
  emptyState: emptyStateField('widgets.charts.anomaly.emptyTitle', 'widgets.charts.anomaly.emptyBody'),
});
export type ChartAnomalyConfig = z.infer<typeof chartAnomalyConfigSchema>;

// --- chart-candlestick -------------------------------------------------------
export const chartCandlestickConfigSchema = widgetSharedConfigSchema.extend({
  /** Corner "live" pill (annex §2 `livePill`). */
  livePill: z.boolean().default(false),
  /** Number of candles to show (annex §2 `candleCount`). */
  candleCount: z.number().int().min(4).max(240).default(40),
  axis: z.boolean().default(true),
  priceFormat: z.enum(['plain', 'compact', 'currency']).default('compact'),
  height: heightField.default(260),
  emptyState: emptyStateField('widgets.charts.candlestick.emptyTitle', 'widgets.charts.candlestick.emptyBody'),
});
export type ChartCandlestickConfig = z.infer<typeof chartCandlestickConfigSchema>;

// --- chart-bump --------------------------------------------------------------
export const chartBumpConfigSchema = widgetSharedConfigSchema.extend({
  /** Override the number of periods; else derived from the payload (annex §2 `periods`). */
  periods: z.number().int().min(2).max(60).optional(),
  /** Override the worst rank shown; else derived (annex §2 `maxRank`). */
  maxRank: z.number().int().min(1).max(60).optional(),
  endLabels: z.boolean().default(true),
  height: heightField.default(240),
  emptyState: emptyStateField('widgets.charts.bump.emptyTitle', 'widgets.charts.bump.emptyBody'),
});
export type ChartBumpConfig = z.infer<typeof chartBumpConfigSchema>;

// --- chart-timeline-lanes ----------------------------------------------------
export const chartTimelineLanesConfigSchema = widgetSharedConfigSchema.extend({
  /** Explicit lane order; else derived from the events' categories (annex §2 `lanes`). */
  lanes: z.array(z.string()).max(12).optional(),
  /** Number of time-axis tick captions (annex §2 `axisBuckets`). */
  axisBuckets: z.number().int().min(0).max(12).default(4),
  height: heightField.default(200),
  emptyState: emptyStateField('widgets.charts.timelineLanes.emptyTitle', 'widgets.charts.timelineLanes.emptyBody'),
});
export type ChartTimelineLanesConfig = z.infer<typeof chartTimelineLanesConfigSchema>;

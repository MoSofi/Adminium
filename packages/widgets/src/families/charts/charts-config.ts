/**
 * Config schemas for the `charts` family M4 base group (annex §2):
 * `chart-line-area`, `chart-bar`, `chart-donut`, `chart-sparkline`. PURE
 * module — zod + the shared config only, no chart primitives and no React —
 * matching the sibling `bars-ranking-config` / `part-whole-config` /
 * `time-flow-config` group convention.
 *
 * WHY THIS EXISTS: `registry/index.ts` statically imports `definitions.ts`, so
 * anything the definitions module imports lands in the registry's EAGER graph.
 * While these schemas lived in `ChartWidgets.tsx`, the definitions had to reach
 * into that component module to name them, pulling the chart wrappers and their
 * @adminium/charts primitives into the eager chunk and leaving the sibling
 * `lazy(() => import('./components.js'))` refs buying nothing (04 §2.3,
 * acceptance #3; enforced by `qa/chunk-budget.test.ts`).
 *
 * `ChartWidgets.tsx` re-exports these symbols so existing story/test import
 * points stay stable.
 */
import { z } from 'zod';

import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

// --- chart-line-area ---------------------------------------------------------

export const chartLineAreaConfigSchema = widgetSharedConfigSchema.extend({
  smooth: z.boolean().default(true),
  /** Axis labels on/off (annex §2 `axis`). */
  axis: z.boolean().default(true),
  /** Dashed prior-period comparison line when the payload carries `compare`. */
  compareToPrior: z.boolean().default(true),
  height: z.number().int().min(80).max(600).default(240),
});

export type ChartLineAreaConfig = z.infer<typeof chartLineAreaConfigSchema>;

// --- chart-bar ---------------------------------------------------------------

export const chartBarConfigSchema = widgetSharedConfigSchema.extend({
  highlight: z.enum(['max', 'current', 'none']).default('max'),
  /** Category labels under the columns (annex §2 `labels`). */
  labels: z.boolean().default(true),
  axis: z.boolean().default(true),
  barRadius: z.number().int().min(0).max(12).default(3),
  height: z.number().int().min(80).max(600).default(220),
});

export type ChartBarConfig = z.infer<typeof chartBarConfigSchema>;

// --- chart-donut -------------------------------------------------------------

export const chartDonutConfigSchema = widgetSharedConfigSchema.extend({
  centerMetric: z.enum(['total', 'none']).default('total'),
  centerLabel: z.string().optional(),
  showLegend: z.boolean().default(true),
  /** Slices beyond this fold into a trailing "Other" bucket. */
  maxSlices: z.number().int().min(2).max(8).default(5),
  metricFormat: z.enum(['plain', 'compact', 'currency', 'percent', 'duration']).default('compact'),
  size: z.number().int().min(96).max(320).default(160),
});

export type ChartDonutConfig = z.infer<typeof chartDonutConfigSchema>;

// --- chart-sparkline ---------------------------------------------------------

export const chartSparklineConfigSchema = widgetSharedConfigSchema.extend({
  variant: z.enum(['bar', 'line']).default('bar'),
  emphasisLast: z.boolean().default(true),
  width: z.number().int().min(24).max(320).default(96),
  height: z.number().int().min(12).max(80).default(28),
});

export type ChartSparklineConfig = z.infer<typeof chartSparklineConfigSchema>;

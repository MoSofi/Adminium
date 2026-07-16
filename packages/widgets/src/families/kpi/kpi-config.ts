/**
 * `kpi` family config schemas + deterministic demo generators — PURE module
 * (zod, the shared config, and the @adminium/charts demo helpers only; no
 * relative component imports, no React).
 *
 * WHY THIS EXISTS: `registry/index.ts` statically imports `definitions.ts`, so
 * everything the definitions module imports lands in the registry's EAGER
 * graph. While the schemas lived in `KpiStatCard.tsx` / `UsageMeter.tsx`, the
 * definitions had to reach into those component modules to name them — which
 * pulled the components and their @adminium/ui deps into the eager chunk and
 * left the sibling `lazy(() => import('./components.js'))` refs buying nothing.
 * Holding the schemas + demo payloads here (the boards/domain/media `*-config`
 * convention) lets the definitions import metadata only, so the components stay
 * reachable exclusively through the lazy `components.ts` barrel (04 §2.3,
 * acceptance #3; enforced by `qa/chunk-budget.test.ts`).
 *
 * The component files re-export these symbols, so existing story/test import
 * points stay stable.
 */
import { demoSparkline, mulberry32 } from '@adminium/charts';
import { z } from 'zod';

import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

// ── kpi-stat-card (annex §1) ───────────────────────────────────────────────
export const kpiStatCardConfigSchema = widgetSharedConfigSchema.extend({
  /** Card label under the icon row (falls back to `title`). */
  metricLabel: z.string().optional(),
  /** Value formatting (annex §1 `format`). */
  metricFormat: z.enum(['plain', 'compact', 'currency', 'percent', 'duration']).default('plain'),
  deltaMode: z.enum(['none', 'pct', 'abs']).default('pct'),
  /** Down-is-good (costs, error rates, churn) — flips the pill tones. */
  invertDeltaGood: z.boolean().default(false),
  showSparkline: z.boolean().default(true),
  /** Curated Lucide tile icon (M4 set — full by-name lookup lands with the builder). */
  iconName: z
    .enum(['activity', 'dollar', 'users', 'cart', 'gauge', 'database', 'zap', 'star', 'package', 'trending'])
    .default('activity'),
  iconTone: z.enum(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']).default('accent'),
});

export type KpiStatCardConfig = z.infer<typeof kpiStatCardConfigSchema>;

/** Deterministic `metric+delta` demo payload (04 §7.7). */
export function kpiStatCardDemoData(seed: number): {
  value: number;
  prior: number;
  spark: number[];
} {
  const random = mulberry32(seed);
  const value = Math.round(1200 + random() * 46_000);
  const prior = Math.round(value * (0.72 + random() * 0.5));
  return { value, prior, spark: demoSparkline(seed, 8) };
}

// ── usage-meter (annex §1) ─────────────────────────────────────────────────
export const usageMeterConfigSchema = widgetSharedConfigSchema.extend({
  /** The quota cap; the data payload carries only the used scalar. */
  limit: z.number().positive().default(100),
  /** Percent thresholds (annex §1 defaults). */
  warnThreshold: z.number().min(0).max(100).default(80),
  dangerThreshold: z.number().min(0).max(100).default(95),
  unit: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaHref: z.string().optional(),
  /** Sidebar mode: single line + slim bar. */
  compact: z.boolean().default(false),
});

export type UsageMeterConfig = z.infer<typeof usageMeterConfigSchema>;

/** Deterministic `single-metric` demo payload against the default limit of 100. */
export function usageMeterDemoData(seed: number): { value: number } {
  const random = mulberry32(seed);
  return { value: Math.round(35 + random() * 60) };
}
